import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { subscription, settings } from "../../db/schema.js";
import { eq, asc, sql } from "drizzle-orm";
import {getFeedInfo} from "../../services/rss.js";
import {YoutubeService} from "../../services/youtube.service.js";
import {ImagesService} from "../../services/images.service.js";
import {isSubPoster, runSubscriptionOnce} from "../../services/worker.js";
import {avatarName, decorateSubscription} from "../../services/avatar.js";
import { removeArchive } from "../../services/ytdlp.js";
import { downloadsFolder, parseFolderOr } from "../../services/paths.js";
import * as ArtworkReplace from "../../services/artwork-replace.js";
import {
  calculateNextCheck,
  normalizePollTimes,
  parseIntervalPeriod
} from "../../utils/schedule.helper.js";
import { broadcast } from "../ws/websockets.js";
import { getLastCheck } from "../../utils/last-check.helper.js";
import { getSavedTimeZone } from "../../utils/time-zone.helper.js";

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
    SELECT (SELECT COUNT(*) FROM subscription WHERE "channelId" = ${channelId})
         + (SELECT COUNT(*) FROM download WHERE "channelId" = ${channelId}) AS n
  `);

  if ((readers?.n ?? 0) > 0) return;

  await ImagesService.remove(avatarName(channelId));
}

export function subscriptionsRoutes(app: FastifyInstance) {
  // GET all
  app.get("/api/subscriptions", async () => {
    const rows = await db
      .select()
      .from(subscription)
      .orderBy(asc(subscription.sortOrder));

    return rows.map(decorateSubscription);
  });

  // GET one
  app.get("/api/subscriptions/:id", async (req) => {
    const { id } = req.params as { id: string };

    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, Number(id)));

    return row ? decorateSubscription(row) : null;
  });

  // CREATE
  app.post("/api/subscriptions", async (req, reply) => {
    const body = req.body as any;

    if (!body.url) {
      return reply.code(400).send({ error: "url is required" });
    }

    const url = body.url.trim();

    const [appSettings] = await db.select().from(settings).where(eq(settings.id, 1));

    // Empty takes the downloads folder setting, "/" is the root. Settled here
    // and stored, so changing the setting later leaves this subscription
    // where it was.
    const folder = parseFolderOr(body.folder, downloadsFolder(appSettings?.downloadsDir));

    if (!folder.ok) {
      return reply.code(400).send({ error: folder.error });
    }

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
      // Only the title is read from it, and the channel page below has that
      // too - so a feed that is down (YouTube's often is) must not stop the
      // subscription from being created.
      const feed = rssUrl
        ? await getFeedInfo(rssUrl).catch((e) => {
            console.warn("Channel feed unavailable:", e?.message ?? e);
            return null;
          })
        : null;

      // ---------- CHANNEL DATA ----------
      let description: string | null = null;
      let avatarPath: string | null = null;
      let pageTitle: string | null = null;

      try {
        const channelUrl = `https://www.youtube.com/channel/${channelId}`;
        const info = await YoutubeService.getChannelInfo(channelUrl);

        if (info) {
          description = info.description ?? null;
          pageTitle = info.title ?? null;

          if (info.avatar) {
            avatarPath = await ImagesService.download(info.avatar, avatarName(channelId!));
          }
        }
      } catch (e) {
        console.warn("Channel metadata failed:", e);
      }

      const last = await db.get<{ max: number }>(sql`
        SELECT MAX("sortOrder") as max FROM subscription
      `);
      const nextOrder = (last?.max ?? -1) + 1;

      // ---------- INSERT ----------
      const result = await db
        .insert(subscription)
        .values({
          channelId,
          sortOrder: nextOrder,
          name: body.name ?? feed?.title ?? pageTitle ?? "Unknown channel",
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
          notifyTelegram: body.notifyTelegram ?? false,
          splitChapters: body.splitChapters ?? false,
          removeSponsors: body.removeSponsors ?? false,

          pollType: body.pollType ?? "interval",
          pollInterval: body.pollInterval ? +body.pollInterval : null,
          pollOnce: body.pollOnce ?? false,
          pollTime: normalizePollTimes(body.pollTime),
          intervalPeriod: parseIntervalPeriod(body.intervalPeriod),

          prefix: body.prefix ?? null,
          folder: folder.folder,
          webhookOverride: body.webhookOverride ?? null
        })
        .returning();

      const created = result[0];
      const nextCheckAt = calculateNextCheck(
        created,
        new Date(),
        await getSavedTimeZone()
      );

      await db.update(subscription)
        .set({ nextCheckAt })
        .where(eq(subscription.id, created.id));

      broadcast('next-check', null);

      await runSubscriptionOnce(created.id).catch(console.error);

      const [full] = await db
        .select()
        .from(subscription)
        .where(eq(subscription.id, created.id));

      return decorateSubscription(full);
    } catch (e) {

      console.error("Create subscription error:", e);

      return reply.code(500).send({
        error: "Failed to create subscription"
      });

    }
  });

  // UPDATE
  app.put("/api/subscriptions/:id", async (req, reply) => {

    const { id } = req.params as { id: string };
    const body = req.body as any;
  
    const [existing] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, Number(id)));
  
    // Only the JSON columns are reshaped; the rest of the body still goes
    // through as it is. Guarded on the key being present so a partial update
    // does not blank a field it never mentioned.
    const patch = { ...body };

    // Owned by the server: a client echoing back the row it was sent would
    // otherwise store the versioned URL (see decorateChannel) in the column.
    delete patch.channelAvatarPath;

    if ("pollTime" in body) {
      patch.pollTime = normalizePollTimes(body.pollTime);
    }

    if ("intervalPeriod" in body) {
      patch.intervalPeriod = parseIntervalPeriod(body.intervalPeriod);
    }

    // Same as on create: cleared takes the downloads folder setting as it is
    // now, "/" is the root. The form shows a subscription stored at the root
    // as "/", so saving it unchanged keeps it there.
    if ("folder" in body) {
      const [appSettings] = await db.select().from(settings).where(eq(settings.id, 1));
      const folder = parseFolderOr(body.folder, downloadsFolder(appSettings?.downloadsDir));

      if (!folder.ok) return reply.code(400).send({ error: folder.error });

      patch.folder = folder.folder;
    }

    const updatedSubscription = {
      ...existing,
      ...patch
    };
  
    const nextCheckAt = calculateNextCheck(
      updatedSubscription,
      new Date(),
      await getSavedTimeZone()
    );
  
    await db.update(subscription)
      .set({
        ...patch,
        nextCheckAt,
        updatedAt: new Date().toISOString()
      })
      .where(eq(subscription.id, Number(id)));
  
    const [updated] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, Number(id)));
  
    broadcast('next-check', await getLastCheck());

    return decorateSubscription(updated);
  });

  /**
   * Replaces the channel's avatar with the uploaded picture (the request body
   * is the image itself). The file is shared per YouTube channel, so this
   * changes it for every subscription on the channel and every download it
   * produced — see services/artwork-replace.ts.
   */
  app.put("/api/subscriptions/:id/avatar", async (req, reply) => {
    const { id } = req.params as { id: string };

    if (!Buffer.isBuffer(req.body)) {
      return reply.code(415).send({ error: "Send the image as the request body" });
    }

    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, Number(id)));

    if (!row) return reply.code(404).send({ error: "Not found" });

    const result = await ArtworkReplace.replaceChannelAvatar(row, req.body);

    if (!result.ok) return reply.code(result.status).send({ error: result.error });

    return result.subscription;
  });

  // DELETE
  app.delete("/api/subscriptions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.id, Number(id)));

    await db
      .delete(subscription)
      .where(eq(subscription.id, Number(id)));

      await db.run(sql`
        UPDATE subscription
        SET "sortOrder" = "sortOrder" - 1
        WHERE "sortOrder" > ${row.sortOrder}
      `);

    // The watcher's download archive goes with it, so adding the same feed
    // back is a fresh subscription rather than one that thinks it has already
    // seen everything.
    await removeArchive(Number(id));

    await releaseAvatar(row?.channelId ?? null);

    // Only the subscription's own copy — a path left over from before the split
    // points at the shared cache, which the download rows still read.
    if (row?.lastVideoThumbnailPath && isSubPoster(row.lastVideoThumbnailPath)) {
      await ImagesService.remove(row.lastVideoThumbnailPath);
    }

    broadcast('next-check', await getLastCheck());

    return { success: true };
  });

  app.post("/api/subscriptions/reorder", async (req) => {
    const { ids } = req.body as { ids: number[] };
  
    await db.transaction((tx) => {
      ids.forEach((id, index) => {
        tx.run(sql`
          UPDATE subscription
          SET sortOrder = ${index}
          WHERE id = ${id}
        `);
      });
    });
  
    return { ok: true };
  });
}
