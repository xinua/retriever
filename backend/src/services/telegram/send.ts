import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { InputFile } from "grammy";
import type { Message } from "grammy/types";

import * as Poster from "../poster.js";
import * as Jpeg from "../jpeg.js";
import * as Bot from "./bot.js";

import type { Download } from "../../db/types.js";

/**
 * Putting a finished download into a chat, for the download bot and the
 * subscription notifications alike.
 */

export type SendKind = "video" | "audio" | "photo" | "document";

/** Telegram's own cap on sendPhoto, local server or not. */
const PHOTO_LIMIT = 10 * 1024 * 1024;

/** What Telegram clients play inline; anything else goes as a document. */
const VIDEO_CONTAINERS = new Set(["mp4", "m4v", "mov"]);
const VIDEO_CODECS = new Set(["h264", "h265"]);
const AUDIO_CONTAINERS = new Set(["mp3", "m4a"]);
const PHOTO_CONTAINERS = new Set(["jpg", "jpeg", "png"]);

/**
 * How a file is best sent, by its container and the video codec the probe
 * found. A file that would only show as a broken player - an mkv, an AV1
 * stream, a flac - goes as a plain document instead.
 */
export function kindFor(filePath: string, bytes: number, codec: string | null): SendKind {
  const ext = path.extname(filePath).slice(1).toLowerCase();

  if (VIDEO_CONTAINERS.has(ext) && (!codec || VIDEO_CODECS.has(codec))) return "video";
  if (AUDIO_CONTAINERS.has(ext)) return "audio";
  if (PHOTO_CONTAINERS.has(ext) && bytes <= PHOTO_LIMIT) return "photo";

  return "document";
}

/** The file's size, or null when it is not there. */
export async function sizeOf(filePath: string): Promise<number | null> {
  return fsp.stat(filePath).then((s) => s.size, () => null);
}

export type SendOptions = {
  kind: SendKind;
  /** HTML, at most 1024 characters once parsed. */
  caption?: string;
  title?: string | null;
  performer?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  /** A JPEG from makeThumbnail; ignored when resending by file_id. */
  thumbPath?: string | null;
};

/**
 * Sends one file to one chat: from disk, or by the file_id an earlier send
 * returned, which Telegram serves without a second upload. Resolves to that
 * file_id, null if the reply somehow carries none.
 */
export async function sendFile(
  chatId: string | number,
  file: { path: string } | { id: string },
  opts: SendOptions
): Promise<string | null> {
  const api = Bot.getApi();

  if (!api) throw new Error("Telegram is off or has no bot token");

  // A local server reads the file itself, from the same path; the cloud API
  // has to be sent the bytes. Made per call: an InputFile is read only once.
  const input =
    "id" in file ? file.id : Bot.isLocal() ? pathToFileURL(file.path).href : new InputFile(file.path);
  const thumbnail = "path" in file && opts.thumbPath ? new InputFile(opts.thumbPath) : undefined;

  const common = opts.caption ? { caption: opts.caption, parse_mode: "HTML" as const } : {};
  const duration = Math.round(opts.duration ?? 0) || undefined;

  let message: Message;

  switch (opts.kind) {
    case "video":
      message = await api.sendVideo(chatId, input, {
        ...common,
        width: opts.width ?? undefined,
        height: opts.height ?? undefined,
        duration,
        thumbnail,
        supports_streaming: true
      });
      break;
    case "audio":
      message = await api.sendAudio(chatId, input, {
        ...common,
        title: opts.title ?? undefined,
        performer: opts.performer ?? undefined,
        duration,
        thumbnail
      });
      break;
    case "photo":
      message = await api.sendPhoto(chatId, input, common);
      break;
    case "document":
      message = await api.sendDocument(chatId, input, { ...common, thumbnail });
      break;
  }

  // Telegram may file a send under another type than asked - a video it
  // cannot play comes back as a document.
  return (
    message.video?.file_id ??
    message.audio?.file_id ??
    message.document?.file_id ??
    message.animation?.file_id ??
    message.photo?.at(-1)?.file_id ??
    null
  );
}

/**
 * The Bot API wants a thumbnail uploaded fresh with every send: a JPEG of at
 * most 320 px a side and 200 kB. Made from the row's own poster, when it has
 * one by now; Telegram makes its own when it has not. The caller removes it.
 */
export async function makeThumbnail(row: Download): Promise<string | null> {
  const source = Poster.fileFor(row);

  if (!source) return null;

  const target = path.join(os.tmpdir(), `retriever-tg-thumb-${row.id}.jpg`);

  return (await Jpeg.convert(source, target, { kind: "box", max: 320 })) ? target : null;
}

export function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
