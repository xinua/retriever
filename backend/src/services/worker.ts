import { db } from "../db/index.js";
import { channel, settings } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

import { getLatestVideo } from "./rss.js";
import * as DownloadQueue from "./download-queue.js";
import { sendWebhook } from "./webhook.js";
import { withLock } from "./lock.js";
import { ImagesService } from "./images.service.js";

import type { Channel, Settings } from "../db/types.js";
import { calculateNextCheck } from "../utils/schedule.helper.js";
import { broadcast } from "../routes/ws/websockets.js";
import { getLastCheck } from "../utils/last-check.helper.js";

let workerTimer: NodeJS.Timeout | null = null;

/**
 * The channel card's own copy of the latest video's artwork.
 *
 * `video-<id>.jpg` is the shared cache every download row reads (see
 * manual-download.ts), so it belongs to the download and has to outlive the
 * channel's interest in it. The card, on the other hand, only ever shows the
 * newest video and wants the previous picture gone — so it gets a copy it is
 * free to delete. Rotating the card no longer strips the poster off the
 * download record for the video that just scrolled out of view.
 */
export function subPosterName(videoId: string): string {
  return `video-${videoId}-sub.jpg`;
}

/**
 * Whether a stored `lastVideoThumbnailPath` is the channel's own copy rather
 * than the shared cache. Rows written before the split still point straight
 * at `video-<id>.jpg`, which must never be deleted on the channel's behalf.
 */
export function isSubPoster(imagePath: string): boolean {
  return imagePath.endsWith("-sub.jpg");
}

/**
 * Fills the shared artwork cache for `videoId` and returns the channel's own
 * copy of it, dropping the copy made for `prevVideoId`. Returns null when the
 * feed carried no thumbnail, or when fetching it failed — artwork is
 * cosmetic, and the scan has more important work to finish.
 */
async function cacheThumbnails(
  videoId: string,
  thumbnailUrl?: string | null,
  prevVideoId?: string | null
) {
  const posterPath = thumbnailUrl
    ? await subPoster(videoId, thumbnailUrl)
    : null;

  // Late enough that a failed fetch leaves the card showing the old picture
  // for one more scan, rather than nothing at all.
  if (prevVideoId && prevVideoId !== videoId) {
    await ImagesService.remove(subPosterName(prevVideoId));
  }

  return posterPath;
}

async function subPoster(videoId: string, thumbnailUrl: string) {
  const shared = `video-${videoId}.jpg`;
  const sub = subPosterName(videoId);

  if (ImagesService.exists(sub)) return `/images/${sub}`;

  if (!ImagesService.exists(shared)) {
    await ImagesService.download(thumbnailUrl, shared);
  }

  // One fetch, two files. Only a shared cache that never landed sends the
  // copy back to the network.
  if (ImagesService.copy(shared, sub)) return `/images/${sub}`;

  return await ImagesService.download(thumbnailUrl, sub);
}

export async function processChannel(
  ch: Channel,
  appSettings: Settings,
  scheduled: boolean = true
) {
  const latest = await getLatestVideo(ch.rssUrl);

  const now = new Date();
  const nowIso = now.toISOString();

  if (!latest) return;

  if (!latest?.videoId) {
    const nextCheckAt = scheduled ? calculateNextCheck(ch, now) : ch.nextCheckAt;
    await db.update(channel)
      .set({
        lastCheckedAt: nowIso,
        nextCheckAt
      })
      .where(eq(channel.id, ch.id));

    broadcast('next-check', await getLastCheck());

    return;
  }

  const isFirstScan = !ch.lastVideoId;

  if (isFirstScan) {

    const thumbnailPath = await cacheThumbnails(
      latest.videoId,
      latest.thumbnail,
      ch.lastVideoId
    );

    const nextCheckAt = scheduled
      ? calculateNextCheck(ch, now)
      : ch.nextCheckAt;

    await db.update(channel)
      .set({
        lastVideoId: latest.videoId,
        lastVideoTitle: latest.title ?? null,
        lastVideoDescription: latest.description ?? null,
        lastVideoThumbnailPath: thumbnailPath,
        lastCaptureAt: nowIso,
        lastCheckedAt: nowIso,
        nextCheckAt,
      })
      .where(eq(channel.id, ch.id));

    if (ch.startFromLast) {
      await DownloadQueue.enqueue({ channel: ch, settings: appSettings, video: latest });

      broadcast(
        'notification',
        {
          type: 'success',
          title: 'Grabbed!',
          subtitle: `Channel: ${ch.name}`,
          message: `${latest.title}`
        });
    }

    return;
  }

  if (latest.videoId === ch.lastVideoId) {

    const nextCheckAt = scheduled
      ? calculateNextCheck(ch, now)
      : ch.nextCheckAt;

    await db.update(channel)
      .set({
        lastCheckedAt: nowIso,
        nextCheckAt,
      })
      .where(eq(channel.id, ch.id));

    broadcast('next-check', await getLastCheck());

    return;
  }

  const thumbnailPath = await cacheThumbnails(
    latest.videoId!,
    latest.thumbnail,
    ch.lastVideoId
  );

  await DownloadQueue.enqueue({ channel: ch, settings: appSettings, video: latest });

  const webhookUrl =
    ch.webhookOverride || appSettings.webhookUrl;

  if (ch.notifyHA && webhookUrl) {
    await sendWebhook(webhookUrl, {
      // The watcher's own id (the one the widget URL takes), not the
      // channel's YouTube id.
      watcherId: ch.id,
      channel: ch.name,
      videoId: latest.videoId,
      title: latest.title,
      type: ch.type,
      date: new Date(nowIso).toISOString()
    });
  }

  const nextCheckAt = scheduled
    ? calculateNextCheck(ch, now)
    : ch.nextCheckAt;

  await db.update(channel)
    .set({
      lastVideoId: latest.videoId,
      lastVideoTitle: latest.title ?? null,
      lastVideoDescription:
        latest.description?.slice(0, 2000) ?? null,
      lastVideoThumbnailPath: thumbnailPath,
      lastCaptureAt: nowIso,
      lastCheckedAt: nowIso,
      nextCheckAt
    })
    .where(eq(channel.id, ch.id));

  const [updatedChannel] = await db
    .select()
    .from(channel)
    .where(eq(channel.id, ch.id));

  broadcast('channel-updated', { channel: updatedChannel });
  broadcast('next-check', await getLastCheck());
  broadcast('notification', {
    type: 'success',
    title: 'New video!',
    subtitle: `Channel: ${ch.name}`,
    message: `Video: ${latest.title}`
  });
}

async function getNextWorkerDelay(): Promise<number> {

  const row = await db.get<{ nextCheckAt: string }>(
    sql`
      SELECT nextCheckAt
      FROM channel
      WHERE enabled = 1
      AND nextCheckAt IS NOT NULL
      ORDER BY nextCheckAt ASC
      LIMIT 1
    `
  );

  if (!row) return 60_000;

  const now = Date.now();
  const target = new Date(row.nextCheckAt).getTime();

  const delay = target - now;

  if (delay <= 0) return 0;

  return Math.min(delay, 60_000);
}

export async function runWorkerTick() {

  const [appSettings] = await db
    .select()
    .from(settings)
    .where(eq(settings.id, 1));

  if (!appSettings?.enabled) return;

  const nowIso = new Date().toISOString();

  const channels = await db
    .select()
    .from(channel)
    .where(sql`
      enabled = 1
      AND nextCheckAt IS NOT NULL
      AND nextCheckAt <= ${nowIso}
    `);

  for (const ch of channels) {

    try {

      await processChannel(ch, appSettings, true);

    } catch (e) {

      console.error("Channel error:", ch.id, e);
      const nextCheckAt = calculateNextCheck(ch, new Date());

      await db.update(channel)
        .set({
          lastCheckedAt: nowIso,
          nextCheckAt
        })
        .where(eq(channel.id, ch.id));

      broadcast('next-check', await getLastCheck());
    }
  }
}

async function workerLoop() {

  await withLock(async () => {
    await runWorkerTick();
  });

  const delay = await getNextWorkerDelay();

  workerTimer = setTimeout(workerLoop, delay);
}

export function startWorker() {

  if (workerTimer) return;

  workerLoop().catch(console.error);
}

export async function runChannelOnce(channelId: number) {

  const [appSettings] = await db
    .select()
    .from(settings)
    .where(eq(settings.id, 1));

  if (!appSettings?.enabled) return;

  const [ch] = await db
    .select()
    .from(channel)
    .where(eq(channel.id, channelId));

  if (!ch) return;

  await processChannel(ch, appSettings, false);
}