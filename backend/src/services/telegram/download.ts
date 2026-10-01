import fsp from "node:fs/promises";
import { eq } from "drizzle-orm";
import { InlineKeyboard, type Context } from "grammy";
import type { LinkPreviewOptions } from "grammy/types";

import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import * as DownloadQueue from "../download-queue.js";
import { startManualDownload } from "../manual-download.js";
import { resolveTarget, type ResolvedTarget } from "../resolve.js";
import * as Bot from "./bot.js";
import * as Send from "./send.js";
import { escape } from "./send.js";
import { formatBytes, mp3Bytes, videoOptions, type VideoOption } from "./formats.js";

import type { Download } from "../../db/types.js";
import type { MediaInfo } from "../media-quality.js";

/**
 * The download bot. A link gets one reply - title, thumbnail and a button
 * per resolution that fits, plus MP3 - and that same message is then edited
 * through the job's life: queued, downloading, uploading, or what went
 * wrong. Once the file is in the chat the status message is removed.
 *
 * Delivery is fixed: video is always mp4 + H.264 through sendVideo, audio
 * always mp3 through sendAudio. Anything else is what the web UI is for.
 */

/** How long a reply's buttons stay usable. */
const SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * Signed stream URLs in an info dict expire. A tap within this window queues
 * the job with the formats already read; a later one lets the queue extract
 * the page again.
 */
const FRESH_INFO_MS = 10 * 60 * 1000;

const URL_PATTERN = /https?:\/\/\S+/i;

type Session = {
  url: string;
  target: ResolvedTarget;
  title: string;
  options: VideoOption[];
  resolvedAt: number;
};

/** Keyed by `chatId:messageId` of the bot's reply. */
const sessions = new Map<string, Session>();

/**
 * The picked format's size, by download id: the fallback for sendVideo when
 * the probe of the finished file has none. Lost on restart, like the probe
 * fallback it is.
 */
const plannedSize = new Map<number, { width: number | null; height: number | null }>();

const keyOf = (chatId: number | string, messageId: number) => `${chatId}:${messageId}`;

function sweepSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;

  for (const [key, session] of sessions) {
    if (session.resolvedAt < cutoff) sessions.delete(key);
  }
}

setInterval(sweepSessions, 10 * 60 * 1000).unref();

function urlFrom(ctx: Context): string | null {
  const message = ctx.message;
  const text = message?.text ?? "";

  for (const entity of message?.entities ?? []) {
    if (entity.type === "text_link") return entity.url;
    if (entity.type === "url") return text.slice(entity.offset, entity.offset + entity.length);
  }

  return text.match(URL_PATTERN)?.[0] ?? null;
}

async function appSettings() {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row;
}

const NO_PREVIEW: LinkPreviewOptions = { is_disabled: true };

/** Edits a status message, ignoring "not modified" and vanished messages. */
async function edit(chatId: string | number, messageId: number, text: string, extra: object = {}) {
  await Bot.getApi()
    ?.editMessageText(chatId, messageId, text, {
      parse_mode: "HTML",
      link_preview_options: NO_PREVIEW,
      ...extra
    })
    .catch((e) => {
      const description = Bot.describe(e);

      if (!/not modified|message to edit not found/i.test(description)) {
        console.warn(`telegram: edit ${chatId}:${messageId} failed:`, description);
      }
    });
}

export async function onText(ctx: Context) {
  if (ctx.message?.text?.startsWith("/")) return;

  const url = urlFrom(ctx);

  if (!url) {
    await ctx.reply("Send me a link to a single video.");
    return;
  }

  const reply = await ctx.reply("🔎 Looking up the link…", {
    reply_parameters: { message_id: ctx.message!.message_id },
    link_preview_options: NO_PREVIEW
  });

  const chatId = reply.chat.id;
  const messageId = reply.message_id;

  const current = await appSettings();

  if (!current) return;

  let target: ResolvedTarget;

  try {
    target = await resolveTarget(url, current);
  } catch (e) {
    await edit(chatId, messageId, `❌ ${escape(Bot.describe(e))}`);
    return;
  }

  const entry = target.entries[0];

  if (target.kind !== "video" || target.entries.length !== 1 || !entry) {
    await edit(chatId, messageId, "Send a single video link — playlists and channels are not supported here.");
    return;
  }

  const options = videoOptions(entry.info);
  const audioBytes = mp3Bytes(entry.info ?? { duration: entry.duration });
  const limit = Bot.uploadLimit();
  const fits = (bytes: number | null) => bytes == null || bytes <= limit;

  const title = entry.title ?? url;

  sessions.set(keyOf(chatId, messageId), {
    url,
    target,
    title,
    options,
    resolvedAt: Date.now()
  });

  const limitNote = `over the ${formatBytes(limit).replace("~", "")} limit`;

  const lines = [
    `<b>${escape(title)}</b>`,
    [entry.channelName, entry.duration ? clock(entry.duration) : null].filter(Boolean).map((s) => escape(String(s))).join(" · "),
    "",
    ...(options.length
      ? options.map((o) =>
          `🎬 ${o.label} · ${formatBytes(o.bytes)}${o.reencode ? " · converted to H.264" : ""}${fits(o.bytes) ? "" : ` — ${limitNote}`}`
        )
      : ["🎬 Video · size unknown"]),
    `🎵 MP3 · ${formatBytes(audioBytes)}${fits(audioBytes) ? "" : ` — ${limitNote}`}`
  ];

  const keyboard = new InlineKeyboard();
  const buttons = options.length
    ? options.filter((o) => fits(o.bytes)).map((o) => ({ text: `🎬 ${o.label}`, data: `v:${o.quality}` }))
    : [{ text: "🎬 Video", data: "v:best" }];

  if (fits(audioBytes)) buttons.push({ text: "🎵 MP3", data: "a" });

  buttons.forEach((b, i) => {
    keyboard.text(b.text, b.data);
    if (i % 2 === 1) keyboard.row();
  });

  if (!buttons.length) {
    lines.push("", `Nothing here fits the ${formatBytes(limit).replace("~", "")} upload limit.`);
  }

  const thumbnail = entry.thumbnail;

  await edit(chatId, messageId, lines.join("\n"), {
    reply_markup: buttons.length ? keyboard : undefined,
    link_preview_options: thumbnail
      ? { url: thumbnail, prefer_large_media: true, show_above_text: true }
      : NO_PREVIEW
  });
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");

  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

export async function onButton(ctx: Context) {
  const data = ctx.callbackQuery?.data ?? "";
  const message = ctx.callbackQuery?.message;

  if (!message) return;

  const chatId = message.chat.id;
  const messageId = message.message_id;
  const key = keyOf(chatId, messageId);
  const session = sessions.get(key);

  if (!session) {
    await ctx.answerCallbackQuery({ text: "This link has expired — send it again." });
    return;
  }

  const audio = data === "a";
  const quality = audio ? "best" : data.startsWith("v:") ? data.slice(2) : null;

  if (!quality) {
    await ctx.answerCallbackQuery();
    return;
  }

  // One tap per reply: the buttons go with the session.
  sessions.delete(key);
  await ctx.answerCallbackQuery();

  const option = session.options.find((o) => o.quality === quality);
  const choice = audio ? "MP3" : option?.label ?? "video";

  await edit(chatId, messageId, `⏳ Queued · ${choice}\n<b>${escape(session.title)}</b>`);

  const current = await appSettings();

  if (!current) return;

  try {
    const result = await startManualDownload(
      {
        url: session.url,
        options: {
          type: audio ? "audio" : "video",
          format: audio ? "mp3" : "mp4",
          codec: audio ? "auto" : "h264",
          quality,
          folder: null,
          prefix: null,
          ytdlpArgs: null,
          clipStart: null,
          clipEnd: null,
          removeSponsors: false,
          splitChapters: false,
          watcherId: null,
          telegram: {
            chatId: String(chatId),
            messageId,
            delivery: audio ? "audio" : "video"
          }
        }
      },
      current,
      Date.now() - session.resolvedAt < FRESH_INFO_MS ? session.target : undefined
    );

    const row = result.downloads[0];

    if (row && option) plannedSize.set(row.id, { width: option.width, height: option.height });
  } catch (e) {
    await edit(chatId, messageId, `❌ ${escape(Bot.describe(e))}\n<b>${escape(session.title)}</b>`);
  }
}

function heading(row: Download): string {
  return `<b>${escape(row.title ?? row.url)}</b>`;
}

async function onStarted(row: Download) {
  if (!row.telegramChatId || !row.telegramMessageId) return;

  await edit(row.telegramChatId, row.telegramMessageId, `⬇️ Downloading…\n${heading(row)}`);
}

async function onFinished(row: Download, media: MediaInfo | null) {
  const chatId = row.telegramChatId;
  const messageId = row.telegramMessageId;

  if (!chatId || !messageId) return;

  const size = plannedSize.get(row.id);

  plannedSize.delete(row.id);

  if (row.status === "canceled") {
    await edit(chatId, messageId, `🚫 Canceled\n${heading(row)}`);
    return;
  }

  if (row.status !== "done" || !row.filePath) {
    await edit(chatId, messageId, `❌ Download failed: ${escape(row.error ?? "unknown error")}\n${heading(row)}`);
    return;
  }

  const api = Bot.getApi();

  if (!api) return;

  const filePath = row.filePath;
  const bytes = await Send.sizeOf(filePath);

  if (bytes == null) {
    await edit(chatId, messageId, `❌ The downloaded file is missing.\n${heading(row)}`);
    return;
  }

  const limit = Bot.uploadLimit();

  if (bytes > limit) {
    const hint = Bot.isLocal() ? "" : " Pick a lower resolution, or set up a local Bot API server for files up to 2 GB.";

    await edit(
      chatId,
      messageId,
      `❌ The file is ${formatBytes(bytes).replace("~", "")}, over the ${formatBytes(limit).replace("~", "")} upload limit.${hint}\n${heading(row)}`
    );
    return;
  }

  await edit(chatId, messageId, `📤 Uploading to Telegram…\n${heading(row)}`);

  const thumbPath = await Send.makeThumbnail(row);
  const audio = row.telegramDelivery === "audio";

  try {
    await Send.sendFile(chatId, { path: filePath }, {
      kind: audio ? "audio" : "video",
      caption: audio ? undefined : escape((row.title ?? "").slice(0, 1000)) || undefined,
      title: row.title,
      performer: row.channelName,
      width: media?.width ?? size?.width,
      height: media?.height ?? size?.height,
      duration: media?.duration ?? row.duration,
      thumbPath
    });
  } catch (e) {
    await edit(chatId, messageId, `❌ Upload failed: ${escape(Bot.describe(e))}\n${heading(row)}`);
    return;
  } finally {
    if (thumbPath) await fsp.rm(thumbPath, { force: true }).catch(() => {});
  }

  await api.deleteMessage(chatId, messageId).catch(() => {});

  // Only ever after a successful send.
  const current = await appSettings();

  if (!current?.telegramKeepFiles) {
    await fsp.rm(filePath, { force: true }).catch((e) =>
      console.warn(`telegram: could not remove ${filePath}:`, e)
    );
    await DownloadQueue.republish([row.id]);
  }
}

/** Follows the queue for the rows the bot queued. Called once at boot. */
export function start(): void {
  DownloadQueue.events.on("started", (row) => {
    void onStarted(row).catch((e) => console.warn("telegram: start notice failed:", e));
  });

  DownloadQueue.events.on("finished", (row, media) => {
    void onFinished(row, media).catch((e) => console.warn(`telegram: delivery of ${row.id} failed:`, e));
  });
}
