import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { channel, download, settings } from "../db/schema.js";
import { broadcast } from "../routes/ws/websockets.js";
import { avatarName, decorateChannel } from "./avatar.js";
import * as CoverArt from "./cover-art.js";
import { withFileExists } from "./download-file.js";
import * as DownloadQueue from "./download-queue.js";
import { ImagesService } from "./images.service.js";
import * as Jpeg from "./jpeg.js";
import * as Poster from "./poster.js";

import type { Channel, Download } from "../db/types.js";

/**
 * Pictures the user brings: a replacement avatar for a YouTube channel, and a
 * replacement poster for a single download — optionally written into its file
 * as cover art too.
 *
 * Both land under the names the app already reads, so nothing that resolves a
 * picture has to know whether it was fetched, captured or uploaded:
 *
 * - an avatar overwrites the shared `channel-<id>.jpg` (see avatar.ts), which
 *   every subscription on that channel and every download it produced shows.
 *   A later re-fetch — a new subscription on the channel — may overwrite it
 *   in turn; uploading again is how to get it back.
 * - a poster becomes the row's own `poster-<id>.jpg` and its thumbnailPath,
 *   never the shared `video-<id>.jpg` another row of the same video reads.
 *
 * Uploads are re-encoded to JPEG and shrunk if large (jpeg.ts), so whatever
 * arrived — PNG, WebP, a phone photo — is stored the way the rest is.
 */

/** Big enough for a crisp round avatar at the largest size the UI draws. */
const AVATAR_BOX = 400;

/**
 * A poster is shown at card size but also embedded as cover art, where a
 * player may draw it full screen — so kept at YouTube's hq720 width rather
 * than the 640 a captured frame gets.
 */
const POSTER_WIDTH = 1280;

export type ReplaceError = { ok: false; status: number; error: string };

/**
 * Downloads whose file is being rewritten right now. A second embed into the
 * same file would race the first for the rename at the end.
 */
const embedding = new Set<number>();

/**
 * Stores `image` as the avatar of the YouTube channel `channelId`, and tells
 * every client about each subscription and download now showing it.
 */
export async function replaceAvatar(
  channelId: string,
  image: Buffer
): Promise<{ ok: true } | ReplaceError> {
  const name = avatarName(channelId);

  if (!(await storeUpload(image, name, { kind: "box", max: AVATAR_BOX }))) {
    return unreadable();
  }

  // Re-pointed as well as re-announced: a subscription whose first fetch
  // failed has no path at all, and now has a picture to show.
  const subs = await db
    .update(channel)
    .set({ channelAvatarPath: `/images/${name}` })
    .where(eq(channel.channelId, channelId))
    .returning();

  for (const sub of subs) {
    broadcast("channel-updated", { channel: decorateChannel(sub) });
  }

  const rows = await db
    .select({ id: download.id })
    .from(download)
    .where(eq(download.channelId, channelId));

  await DownloadQueue.republish(rows.map((r) => r.id));

  return { ok: true };
}

/** replaceAvatar for the channel behind a subscription. */
export async function replaceChannelAvatar(
  sub: Channel,
  image: Buffer
): Promise<{ ok: true; channel: Channel } | ReplaceError> {
  if (!sub.channelId) {
    return { ok: false, status: 400, error: "Subscription has no YouTube channel" };
  }

  const result = await replaceAvatar(sub.channelId, image);

  if (!result.ok) return result;

  const [updated] = await db.select().from(channel).where(eq(channel.id, sub.id));

  return { ok: true, channel: decorateChannel(updated) };
}

/**
 * replaceAvatar for the channel behind a download. Only YouTube rows have a
 * per-channel picture; the rest show a bundled site mark (see avatar.ts),
 * which is nobody's to replace.
 */
export async function replaceDownloadAvatar(
  row: Download,
  image: Buffer
): Promise<{ ok: true; download: Presented } | ReplaceError> {
  if (row.platform !== "youtube" || !row.channelId) {
    return { ok: false, status: 400, error: "Only YouTube downloads have a replaceable avatar" };
  }

  const result = await replaceAvatar(row.channelId, image);

  if (!result.ok) return result;

  return { ok: true, download: await present(row.id) };
}

/**
 * Stores `image` as the poster of one download and, when `embed` is set,
 * writes it into the finished file as its cover.
 *
 * `coverEmbedded` says how the second half went: null when it was not asked
 * for, false when it could not be done — no file on disk, a container with
 * nowhere to put a picture, ffmpeg refusing. The poster itself is replaced
 * either way.
 */
export async function replacePoster(
  row: Download,
  image: Buffer,
  embed: boolean
): Promise<{ ok: true; download: Presented; coverEmbedded: boolean | null } | ReplaceError> {
  // A thumbnail job's poster is the file it downloaded.
  if (row.type === "thumbnail") {
    return { ok: false, status: 400, error: "A thumbnail download has no separate poster" };
  }

  // The worker writes thumbnailPath and the file itself while it runs, and
  // would overwrite either a moment later.
  if (row.status === "queued" || row.status === "running") {
    return { ok: false, status: 409, error: "Download is still active" };
  }

  if (embed && embedding.has(row.id)) {
    return { ok: false, status: 409, error: "The file is already being updated" };
  }

  const name = Poster.posterName(row.id);

  if (!(await storeUpload(image, name, { kind: "width", max: POSTER_WIDTH }))) {
    return unreadable();
  }

  await db
    .update(download)
    .set({ thumbnailPath: `/images/${name}` })
    .where(eq(download.id, row.id));

  // The new poster is out before the file is touched, which for a large
  // video takes a while.
  await DownloadQueue.republish([row.id]);

  const coverEmbedded = embed ? await embedPoster(row.id, name) : null;

  return { ok: true, download: await present(row.id), coverEmbedded };
}

async function embedPoster(id: number, posterFile: string): Promise<boolean> {
  embedding.add(id);

  try {
    const [row] = await db.select().from(download).where(eq(download.id, id));
    const [appSettings] = await db.select().from(settings).where(eq(settings.id, 1));

    if (!row?.filePath || !appSettings || !CoverArt.supports(row.filePath)) return false;

    // Only a file the app would itself serve — inside the downloads folder,
    // and there right now. Written to, after all.
    const [checked] = await withFileExists([row], appSettings);

    if (!checked?.fileExists) return false;

    if (!(await CoverArt.embed(row.filePath, ImagesService.pathFor(posterFile)))) return false;

    // The picture now lives inside the file, so its size has moved.
    const size = await fsp.stat(row.filePath).then((s) => s.size, () => null);

    if (size != null) {
      await db.update(download).set({ totalBytes: size }).where(eq(download.id, id));
    }

    await DownloadQueue.republish([id]);

    return true;
  } finally {
    embedding.delete(id);
  }
}

/**
 * Writes an uploaded picture under `filename` in the images store, as a JPEG.
 * The upload goes to a temp file first because ffmpeg reads from a path; the
 * stored file is only replaced once the conversion has worked, so a picture
 * ffmpeg cannot read leaves the old one in place.
 */
async function storeUpload(image: Buffer, filename: string, fit: Jpeg.Fit): Promise<boolean> {
  if (!image.length) return false;

  const temp = path.join(os.tmpdir(), `retriever-upload-${crypto.randomUUID()}`);

  try {
    await fsp.writeFile(temp, image);

    return await Jpeg.convert(temp, ImagesService.pathFor(filename), fit);
  } catch (e) {
    console.warn("Image upload failed:", e);
    return false;
  } finally {
    await fsp.rm(temp, { force: true }).catch(() => {});
  }
}

/** A row the way every other download endpoint returns one. */
async function present(id: number) {
  const [row] = await db.select().from(download).where(eq(download.id, id));
  const [appSettings] = await db.select().from(settings).where(eq(settings.id, 1));

  if (!row) return null;

  const decorated = Poster.decorate(row);

  if (!appSettings) return { ...decorated, fileExists: false };

  const [withFile] = await withFileExists([decorated], appSettings);

  return withFile;
}

type Presented = Awaited<ReturnType<typeof present>>;

function unreadable(): ReplaceError {
  return { ok: false, status: 422, error: "The image could not be read" };
}
