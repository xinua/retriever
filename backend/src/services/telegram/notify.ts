import fsp from "node:fs/promises";

import * as Bot from "./bot.js";
import * as Chats from "./chats.js";
import * as Send from "./send.js";
import { escape } from "./send.js";
import { formatBytes } from "./formats.js";

import type { Download } from "../../db/types.js";
import type { MediaInfo } from "../media-quality.js";

/**
 * Notifications go to every chat with "Notify" on, approved or not: they are
 * only ever sent outwards, so the whitelist has nothing to guard here.
 */

export type SendResult = { sent: number; errors: { chatId: string; name: string | null; error: string }[] };

async function broadcastText(text: string): Promise<SendResult> {
  const api = Bot.getApi();
  const result: SendResult = { sent: 0, errors: [] };

  if (!api) return result;

  for (const chat of await Chats.notifyTargets()) {
    try {
      await api.sendMessage(chat.chatId, text, { parse_mode: "HTML" });
      result.sent++;
    } catch (e) {
      const error = Bot.describe(e);

      console.warn(`telegram: notification to ${chat.chatId} failed:`, error);
      result.errors.push({ chatId: chat.chatId, name: chat.name, error });
    }
  }

  return result;
}

/** Channel and linked title, kept well inside the 1024-character caption cap. */
function captionFor(row: Download): string {
  const title = escape((row.title ?? "New video").slice(0, 700));
  const channel = escape((row.channelName ?? "Subscription").slice(0, 200));

  return `🎬 <b>${channel}</b>\n<a href="${escape(row.url)}">${title}</a>`;
}

/**
 * A subscription's download is done: the file itself goes to every chat with
 * "Notify" on. Uploaded once; the other chats get it by file_id. A file over
 * the upload limit, or one a chat would not take, is announced as text
 * instead, so the chat still hears about the video. The file stays on disk
 * either way - it was downloaded for the library, not for Telegram.
 */
export async function newDownload(row: Download, media: MediaInfo | null): Promise<void> {
  const chats = await Chats.notifyTargets();

  if (!Bot.getApi() || !chats.length) return;

  const caption = captionFor(row);
  const filePath = row.filePath;
  const bytes = filePath ? await Send.sizeOf(filePath) : null;

  if (!filePath || bytes == null) {
    await broadcastText(`${caption}\n<i>Downloaded, but the file could not be found to send.</i>`);
    return;
  }

  const limit = Bot.uploadLimit();

  if (bytes > limit) {
    const size = formatBytes(bytes).replace("~", "");

    await broadcastText(
      `${caption}\n<i>${size} is over the ${formatBytes(limit).replace("~", "")} upload limit, so it is only on the server.</i>`
    );
    return;
  }

  const kind = Send.kindFor(filePath, bytes, media?.codec ?? row.mediaCodec);
  const thumbPath = await Send.makeThumbnail(row);
  let fileId: string | null = null;

  try {
    for (const chat of chats) {
      try {
        const id = await Send.sendFile(chat.chatId, fileId ? { id: fileId } : { path: filePath }, {
          kind,
          caption,
          title: row.title,
          performer: row.channelName,
          width: media?.width,
          height: media?.height,
          duration: media?.duration ?? row.duration,
          thumbPath
        });

        fileId ??= id;
      } catch (e) {
        const error = Bot.describe(e);

        console.warn(`telegram: sending ${filePath} to ${chat.chatId} failed:`, error);

        await Bot.getApi()
          ?.sendMessage(chat.chatId, `${caption}\n<i>Could not send the file: ${escape(error)}</i>`, {
            parse_mode: "HTML"
          })
          .catch(() => {});
      }
    }
  } finally {
    if (thumbPath) await fsp.rm(thumbPath, { force: true }).catch(() => {});
  }
}

export async function downloadFailed(row: Download): Promise<void> {
  const title = escape(row.title ?? row.url);
  const channel = row.channelName ? ` · ${escape(row.channelName)}` : "";

  await broadcastText(
    `❌ <b>Download failed</b>${channel}\n${title}${row.error ? `\n<i>${escape(row.error.slice(0, 500))}</i>` : ""}`
  );
}

export async function test(): Promise<SendResult> {
  if (!Bot.getApi()) throw new Error("Telegram is off or has no bot token");

  return broadcastText("✅ Retriever test notification");
}
