import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { channel } from "../../db/schema.js";
import { eq, asc, sql } from "drizzle-orm";
import {getFeedInfo} from "../../services/rss.js";
import {YoutubeService} from "../../services/youtube.service.js";
import {ImagesService} from "../../services/images.service.js";
import {isSubPoster, runChannelOnce} from "../../services/worker.js";
import {avatarName} from "../../services/avatar.js";
import { removeArchive } from "../../services/ytdlp.js";
import {
  calculateNextCheck,
  normalizePollTimes,
  parseIntervalPeriod
} from "../../utils/schedule.helper.js";
import { broadcast } from "../ws/websockets.js";
import { getLastCheck } from "../../utils/last-check.helper.js";

function isRssUrl(url: string) {
  return url.includes("feeds/videos.xml");
}

function extractChannelIdFromRss(url: string): string | null {
  const match = url.match(/channel_id=([^&]+)/);
  return match?.[1] ?? null;
}

/**
 * Drops the channel's avatar, unless something else is still looking at it.
 *
 * `channel-<id>.jpg` is one file per YouTube channel, not per subscription
 * (see avatar.ts): a second subscription on the same channel reads it, and so
 * does every download row that channel produced — which outlive the
 * subscription, since deleting one only nulls their `watcherId`. Nothing
 * re-fetches it on their behalf, so removing it with the first subscription
 * to go stripped the picture off the survivors for good.
 *
 * The count runs after the row is gone, so what it sees is exactly the
 * readers that remain.
 */
async function releaseAvatar(channelId: string | null) {
  if (!channelId) return;

  const readers = await db.get<{ n: number }>(sql`
    SELECT (SELECT COUNT(*) FROM channel WHERE "channelId" = ${channelId})
         + (SELECT COUNT(*) FROM download WHERE "channelId" = ${channelId}) AS n
  `);

  if ((readers?.n ?? 0) > 0) return;

  await ImagesService.remove(avatarName(channelId));
}

export function channelsRoutes(app: FastifyInstance) {
  // GET all
  app.get("/api/channels", () => {
    return db
      .select()
      .from(channel)
      .orderBy(asc(channel.sortOrder));
  });

  // GET one
  app.get("/api/channels/:id", async (req) => {
    const { id } = req.params as { id: string };

    const [row] = await db
      .select()
      .from(channel)
      .where(eq(channel.id, Number(id)));

    return row ?? null;
  });

  // CREATE
  app.post("/api/channels", async (req, reply) => {
    const body = req.body as any;

    if (!body.url) {
      return reply.code(400).send({ error: "url is required" });
    }

    const url = body.url.trim();

    try {

      let rssUrl: string | null = null;
      let channelId: string | null = null;

      // ---------- RSS ----------
      if (isRssUrl(url)) {

        rssUrl = url;
        channelId = extractChannelIdFromRss(url);

        if (!channelId) {
          return reply.code(400).send({
            error: "Invalid RSS URL"
          });
        }
      }

      // ---------- CHANNEL ----------
      else {

        const info = await YoutubeService.getChannelInfo(url);

        if (!info) {
          return reply.code(400).send({
            error: "Cannot parse channel URL"
          });
        }

        rssUrl = info.rssUrl;
        channelId = info.channelId;

      }

      // ---------- RSS DATA ----------
      const feed = rssUrl ? await getFeedInfo(rssUrl) : null;

      // ---------- CHANNEL DATA ----------
      let description: string | null = null;
      let avatarPath: string | null = null;

      try {
        const channelUrl = `https://www.youtube.com/channel/${channelId}`;
        const info = await YoutubeService.getChannelInfo(channelUrl);

        if (info) {
          description = info.description ?? null;

          if (info.avatar) {
            avatarPath = await ImagesService.download(info.avatar, avatarName(channelId!));
          }
        }
      } catch (e) {
        console.warn("Channel metadata failed:", e);
      }

      const last = await db.get<{ max: number }>(sql`
        SELECT MAX("sortOrder") as max FROM channel
      `);
      const nextOrder = (last?.max ?? -1) + 1;

      // ---------- INSERT ----------
      const result = await db
        .insert(channel)
        .values({
          channelId,
          sortOrder: nextOrder,
          name: body.name ?? feed!.title ?? "Unknown channel",
          channelDescription: description,
          channelAvatarPath: avatarPath,
          rssUrl: rssUrl as string,

          type: body.type ?? "video",
          codec: body.codec ?? null,
          format: body.format ?? "mp4",
          ytdlpArgs: body.ytdlpArgs ?? null,
          enabled: body.enabled ?? true,
          startFromLast: body.startFromLast ?? true,
          downloadShorts: body.downloadShorts ?? false,
          notifyHA: body.notifyHA ?? false,
          splitChapters: body.splitChapters ?? false,
          removeSponsors: body.removeSponsors ?? false,

          pollType: body.pollType ?? "interval",
          pollInterval: body.pollInterval ? +body.pollInterval : null,
          pollOnce: body.pollOnce ?? false,
          pollTime: normalizePollTimes(body.pollTime),
          intervalPeriod: parseIntervalPeriod(body.intervalPeriod),

          prefix: body.prefix ?? null,
          tag: body.tag ?? null,
          webhookOverride: body.webhookOverride ?? null
        })
        .returning();

      const created = result[0];
      const nextCheckAt = calculateNextCheck(created, new Date());

      await db.update(channel)
        .set({ nextCheckAt })
        .where(eq(channel.id, created.id));

      broadcast('next-check', null);

      await runChannelOnce(created.id).catch(console.error);

      const [full] = await db
        .select()
        .from(channel)
        .where(eq(channel.id, created.id));

      return full;
    } catch (e) {

      console.error("Create channel error:", e);

      return reply.code(500).send({
        error: "Failed to create channel"
      });

    }
  });

  // UPDATE
  app.put("/api/channels/:id", async (req) => {

    const { id } = req.params as { id: string };
    const body = req.body as any;
  
    const [existing] = await db
      .select()
      .from(channel)
      .where(eq(channel.id, Number(id)));
  
    // Only the JSON columns are reshaped; the rest of the body still goes
    // through as it is. Guarded on the key being present so a partial update
    // does not blank a field it never mentioned.
    const patch = { ...body };

    if ("pollTime" in body) {
      patch.pollTime = normalizePollTimes(body.pollTime);
    }

    if ("intervalPeriod" in body) {
      patch.intervalPeriod = parseIntervalPeriod(body.intervalPeriod);
    }

    const updatedChannel = {
      ...existing,
      ...patch
    };
  
    const nextCheckAt = calculateNextCheck(
      updatedChannel,
      new Date()
    );
  
    await db.update(channel)
      .set({
        ...patch,
        nextCheckAt,
        updatedAt: new Date().toISOString()
      })
      .where(eq(channel.id, Number(id)));
  
    const [updated] = await db
      .select()
      .from(channel)
      .where(eq(channel.id, Number(id)));
  
    broadcast('next-check', await getLastCheck());

    return updated;
  });

  // DELETE
  app.delete("/api/channels/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await db
    .select()
    .from(channel)
    .where(eq(channel.id, Number(id)));

    await db
      .delete(channel)
      .where(eq(channel.id, Number(id)));

      await db.run(sql`
        UPDATE channel
        SET "sortOrder" = "sortOrder" - 1
        WHERE "sortOrder" > ${row.sortOrder}
      `);

    // The watcher's download archive goes with it, so adding the same feed
    // back is a fresh subscription rather than one that thinks it has already
    // seen everything.
    await removeArchive(Number(id));

    await releaseAvatar(row?.channelId ?? null);

    // Only the channel's own copy — a path left over from before the split
    // points at the shared cache, which the download rows still read.
    if (row?.lastVideoThumbnailPath && isSubPoster(row.lastVideoThumbnailPath)) {
      await ImagesService.remove(row.lastVideoThumbnailPath);
    }

    broadcast('next-check', await getLastCheck());

    return { success: true };
  });

  app.post("/api/channels/reorder", async (req) => {
    const { ids } = req.body as { ids: number[] };
  
    await db.transaction((tx) => {
      ids.forEach((id, index) => {
        tx.run(sql`
          UPDATE channel
          SET sortOrder = ${index}
          WHERE id = ${id}
        `);
      });
    });
  
    return { ok: true };
  });
}
