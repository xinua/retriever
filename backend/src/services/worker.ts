import { db } from "../db/index.js";
import { channel, settings } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

import { getFeedVideos, type RssVideo } from "./rss.js";
import { isShort } from "./shorts.js";
import * as DownloadQueue from "./download-queue.js";
import { sendWebhook } from "./webhook.js";
import { withLock } from "./lock.js";
import { ImagesService } from "./images.service.js";
import { avatarName } from "./avatar.js";
import { YoutubeService } from "./youtube.service.js";

import type { Channel, Settings } from "../db/types.js";
import { calculateNextCheck, isHeldForToday } from "../utils/schedule.helper.js";
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

/**
 * How far down the feed a scan will look for something to capture. Only a
 * subscription filtering Shorts out ever goes past the first entry, and every
 * step past it costs one HEAD request — so the walk is capped well inside the
 * fifteen-or-so entries the feed carries.
 */
const MAX_FEED_WALK = 10;

/**
 * The newest entry this subscription is actually interested in, or null when
 * the feed holds nothing new for it.
 *
 * With Shorts included that is simply the newest entry, which is what every
 * subscription did before the flag was honoured. With them excluded the walk
 * keeps going instead of stopping there: a channel that posts a Short after a
 * video would otherwise leave the video buried one place down the feed and
 * never look at it again, so turning Shorts off would quietly stop the
 * subscription rather than filter it.
 *
 * It stops at the last captured video because everything below that has
 * already been offered once. An ignored Short is deliberately not recorded as
 * the last video — it was never captured, and the card, the widget and the
 * `pollOnce` hold all read that field as the video this subscription grabbed
 * — so it is re-examined on the next scan, which is why the verdicts are
 * cached in shorts.ts.
 */
async function pickLatest(
  ch: Channel,
  videos: RssVideo[]
): Promise<RssVideo | null> {

  for (const video of videos.slice(0, MAX_FEED_WALK)) {

    if (!video.videoId) continue;
    if (video.videoId === ch.lastVideoId) return null;
    if (ch.downloadShorts) return video;

    if (await isShort(video)) {
      console.log(`Channel ${ch.id}: ignoring short ${video.videoId}`);
      continue;
    }

    return video;
  }

  return null;
}

/**
 * How long to leave a channel alone after a failed avatar fetch, so a
 * picture YouTube will not hand over is not asked for on every single scan.
 * In memory only: a restart is rare enough, and cheap enough, to retry.
 */
const AVATAR_RETRY_MS = 6 * 60 * 60 * 1000;

const avatarAttempts = new Map<string, number>();

/**
 * Puts the channel's avatar back when it has gone missing from disk.
 *
 * `channel-<id>.jpg` is shared by every reader of that channel (see
 * avatar.ts) and was only ever written once, when a subscription was created
 * or a manual download resolved — so anything that removed it, including the
 * delete route before it learned to count its readers, left the card and
 * every download row of that channel with the "not found" stand-in for good.
 * The scan is the one thing that comes back to a channel regularly, so it is
 * where the file is noticed missing and fetched again.
 *
 * The column is re-pointed at the same time: it may be null on a row whose
 * first fetch failed, and stale on one whose file was deleted underneath it.
 */
async function ensureAvatar(ch: Channel): Promise<void> {
  if (!ch.channelId) return;

  const name = avatarName(ch.channelId);
  const publicPath = `/images/${name}`;

  if (ImagesService.exists(name)) {
    if (ch.channelAvatarPath !== publicPath) {
      await db.update(channel)
        .set({ channelAvatarPath: publicPath })
        .where(eq(channel.id, ch.id));
    }

    return;
  }

  const lastTry = avatarAttempts.get(ch.channelId) ?? 0;

  if (Date.now() - lastTry < AVATAR_RETRY_MS) return;

  avatarAttempts.set(ch.channelId, Date.now());

  try {
    const info = await YoutubeService.getChannelInfo(
      `https://www.youtube.com/channel/${ch.channelId}`
    );

    if (!info?.avatar) return;

    const stored = await ImagesService.download(info.avatar, name);

    if (!stored) return;

    await db.update(channel)
      .set({ channelAvatarPath: stored })
      .where(eq(channel.id, ch.id));

    avatarAttempts.delete(ch.channelId);
  } catch (e) {
    console.warn("Avatar refresh failed:", e);
  }
}

export async function processChannel(
  ch: Channel,
  appSettings: Settings,
  scheduled: boolean = true
) {
  await ensureAvatar(ch);

  const feed = await getFeedVideos(ch.rssUrl);
  const latest = await pickLatest(ch, feed.videos);

  const now = new Date();
  const nowIso = now.toISOString();

  // Nothing new, nothing this subscription wants, or a feed that carried no
  // usable entry at all: the scan still happened, so it books the next one.
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

    // Scheduled against the capture this scan is about to write, not the one
    // on the row it read - otherwise a `pollOnce` subscription books another
    // check for today and only holds off from the tick after that.
    const nextCheckAt = scheduled
      ? calculateNextCheck({ ...ch, lastCaptureAt: nowIso }, now)
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
    ? calculateNextCheck({ ...ch, lastCaptureAt: nowIso }, now)
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

    const now = new Date();

    // A `pollOnce` subscription that has captured today is not polled again
    // until tomorrow, whatever its row says is due: `nextCheckAt` can still
    // point at today after a manual run, or after the flag was turned on with
    // a check already booked.
    if (isHeldForToday(ch, now)) {

      await db.update(channel)
        .set({ nextCheckAt: calculateNextCheck(ch, now) })
        .where(eq(channel.id, ch.id));

      broadcast('next-check', await getLastCheck());

      continue;
    }

    try {

      await processChannel(ch, appSettings, true);

    } catch (e) {

      console.error("Channel error:", ch.id, e);
      const nextCheckAt = calculateNextCheck(ch, now);

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