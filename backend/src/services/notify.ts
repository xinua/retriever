import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { channel, settings } from "../db/schema.js";
import { sendWebhook } from "./webhook.js";
import * as DownloadQueue from "./download-queue.js";
import * as TelegramNotify from "./telegram/notify.js";

import type { Channel, Download, Settings } from "../db/types.js";
import type { MediaInfo } from "./media-quality.js";

/**
 * Everything the app tells the outside world about, in one place: each
 * function here fans one event out to every channel that should hear it.
 * A failing channel is logged and never stops the others, or the caller.
 */

export type NewVideo = {
  videoId?: string | null;
  title?: string | null;
  link?: string | null;
};

/**
 * A subscription captured a new video: the webhook goes to the
 * subscription's override or the global URL. Telegram waits for the download
 * instead, to send the file itself - see notifyDownloaded.
 */
export async function notifyNewVideo(
  ch: Channel,
  video: NewVideo,
  appSettings: Settings,
  date: string
): Promise<void> {
  const webhookUrl = ch.notifyHA ? ch.webhookOverride || appSettings.webhookUrl : null;

  if (webhookUrl) {
    await sendWebhook(webhookUrl, {
      // The watcher's own id (the one the widget URL takes), not the
      // channel's YouTube id.
      watcherId: ch.id,
      channel: ch.name,
      videoId: video.videoId,
      title: video.title,
      type: ch.type,
      date: new Date(date).toISOString()
    }).catch((e) => console.warn(`notify: webhook for ${ch.name} failed:`, e));
  }
}

/** The subscription a watcher row came from, when its Telegram flag is on. */
async function telegramChannel(row: Download): Promise<Channel | null> {
  if (row.source !== "watcher" || row.watcherId == null) return null;

  const [ch] = await db.select().from(channel).where(eq(channel.id, row.watcherId));

  return ch?.notifyTelegram ? ch : null;
}

/**
 * A subscription's download is done: the file goes to Telegram when the
 * subscription's flag is on. Manual and bot downloads are left out, as below.
 */
async function notifyDownloaded(row: Download, media: MediaInfo | null): Promise<void> {
  if (!(await telegramChannel(row))) return;

  await TelegramNotify.newDownload(row, media);
}

/**
 * A subscription's download ended in "failed". Telegram only, and only when
 * both the global toggle and the subscription's own Telegram flag are on.
 * Manual and bot downloads are left out: whoever asked for those is watching
 * them already, in the web UI or in the bot's status message.
 */
async function notifyDownloadFailed(row: Download): Promise<void> {
  const [appSettings] = await db.select().from(settings).where(eq(settings.id, 1));

  if (!appSettings?.notifyDownloadFailed) return;
  if (!(await telegramChannel(row))) return;

  await TelegramNotify.downloadFailed(row);
}

/** Subscribes to the queue events that notify. Called once at boot. */
export function start(): void {
  DownloadQueue.events.on("finished", (row, media) => {
    if (row.status === "done") {
      void notifyDownloaded(row, media).catch((e) =>
        console.warn(`notify: sending download ${row.id} to telegram failed:`, e)
      );
    } else if (row.status === "failed") {
      void notifyDownloadFailed(row).catch((e) =>
        console.warn(`notify: download ${row.id} failure notice failed:`, e)
      );
    }
  });
}
