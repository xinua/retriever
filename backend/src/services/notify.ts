import path from "node:path";

import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { channel, settings } from "../db/schema.js";
import { sendWebhook } from "./webhook.js";
import * as DownloadQueue from "./download-queue.js";
import * as ytdlp from "./ytdlp.js";
import * as TelegramNotify from "./telegram/notify.js";

import type { Channel, Download, Settings } from "../db/types.js";
import type { MediaInfo } from "./media-quality.js";

/**
 * Everything the app tells the outside world about, in one place: each
 * function here fans one event out to every channel that should hear it.
 * A failing channel is logged and never stops the others, or the caller.
 */

/**
 * A subscription's download is done: the webhook goes to the subscription's
 * override or the global URL. Sent on the finished file rather than on
 * detection, so the payload can say where the file is.
 */
async function notifyWebhook(row: Download, ch: Channel): Promise<void> {
  if (!ch.notifyHA) return;

  const [appSettings] = await db.select().from(settings).where(eq(settings.id, 1));
  const webhookUrl = ch.webhookOverride || appSettings?.webhookUrl;

  if (!webhookUrl) return;

  await sendWebhook(webhookUrl, {
    // The watcher's own id (the one the widget URL takes), not the
    // channel's YouTube id.
    watcherId: ch.id,
    channel: ch.name,
    videoId: row.videoId,
    title: row.title,
    type: row.type,
    date: new Date(row.finishedAt ?? Date.now()).toISOString(),
    // Relative to the downloads folder, e.g. "music/Song.mp3".
    path: relativeToDownloads(row.filePath, appSettings),
    fileUrl: fileUrl(row)
  });
}

/**
 * Asked for from a download's menu: posts the file to the global webhook so
 * a Home Assistant automation can play it. Throws when the receiver refuses.
 */
export async function sendDownloadToHA(row: Download, appSettings: Settings): Promise<void> {
  if (!appSettings.webhookUrl) throw new Error("No webhook URL is set");

  await sendWebhook(appSettings.webhookUrl, {
    id: row.id,
    title: row.title,
    filePath: relativeToDownloads(row.filePath, appSettings),
    fileUrl: fileUrl(row),
    type: row.type,
    format: row.format
  });
}

/** The same inline stream the widget and the downloads list play. */
function fileUrl(row: Download): string {
  return `/api/downloads/${row.id}/file?inline=1`;
}

function relativeToDownloads(filePath: string | null, appSettings: Settings | undefined): string | null {
  if (!filePath?.trim() || !appSettings) return null;

  const rel = path.relative(ytdlp.downloadsRoot(appSettings), filePath.trim());

  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : null;
}

/** The subscription a watcher row came from. */
async function watcherChannel(row: Download): Promise<Channel | null> {
  if (row.source !== "watcher" || row.watcherId == null) return null;

  const [ch] = await db.select().from(channel).where(eq(channel.id, row.watcherId));

  return ch ?? null;
}

/**
 * A subscription's download is done: the webhook and, when the
 * subscription's flag is on, the file to Telegram. Manual and bot downloads
 * are left out, as below.
 */
async function notifyDownloaded(row: Download, media: MediaInfo | null): Promise<void> {
  const ch = await watcherChannel(row);

  if (!ch) return;

  await Promise.all([
    notifyWebhook(row, ch).catch((e) => console.warn(`notify: webhook for ${ch.name} failed:`, e)),
    ch.notifyTelegram
      ? TelegramNotify.newDownload(row, media).catch((e) =>
          console.warn(`notify: sending download ${row.id} to telegram failed:`, e)
        )
      : null
  ]);
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
  if (!(await watcherChannel(row))?.notifyTelegram) return;

  await TelegramNotify.downloadFailed(row);
}

/** Subscribes to the queue events that notify. Called once at boot. */
export function start(): void {
  DownloadQueue.events.on("finished", (row, media) => {
    if (row.status === "done") {
      void notifyDownloaded(row, media).catch((e) =>
        console.warn(`notify: download ${row.id} notifications failed:`, e)
      );
    } else if (row.status === "failed") {
      void notifyDownloadFailed(row).catch((e) =>
        console.warn(`notify: download ${row.id} failure notice failed:`, e)
      );
    }
  });
}
