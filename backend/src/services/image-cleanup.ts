import fsp from "node:fs/promises";
import path from "node:path";

import { db } from "../db/index.js";
import { download, subscription } from "../db/schema.js";
import { avatarName } from "./avatar.js";
import { ImagesService } from "./images.service.js";
import { posterName } from "./poster.js";
import { subPosterName } from "./worker.js";

/**
 * The names this app writes into the images store. A file that matches none
 * of them was put there by someone else and is never touched.
 */
const OWN_IMAGE = /^(video-.+|channel-.+|poster-\d+)\.jpg$/;

/**
 * A file this young may belong to a download whose row is still being
 * written, so it is left for the next cleanup.
 */
const GRACE_MS = 60 * 60 * 1000;

export interface CleanupResult {
  total: number;
  totalSizeKB: number;
}

/**
 * Every image name a row still reads. Most of them are found by naming
 * convention rather than by a stored path: `video-<videoId>.jpg` is shared by
 * every row of the same video, and a download's uploader avatar is
 * `channel-<channelId>.jpg` with no column pointing at it (see avatar.ts and
 * poster.ts). The stored paths are added as well, so a renamed scheme can't
 * strand a file a column points at.
 */
async function imagesInUse(): Promise<Set<string>> {
  const keep = new Set<string>();
  const add = (name: string | null | undefined) => name && keep.add(name);
  const addPath = (publicPath: string | null | undefined) =>
    publicPath && add(ImagesService.nameOf(publicPath));

  const downloads = await db
    .select({
      id: download.id,
      videoId: download.videoId,
      channelId: download.channelId,
      thumbnailPath: download.thumbnailPath
    })
    .from(download);

  for (const row of downloads) {
    add(posterName(row.id));
    if (row.videoId) add(`video-${row.videoId}.jpg`);
    if (row.channelId) add(avatarName(row.channelId));
    addPath(row.thumbnailPath);
  }

  const subs = await db
    .select({
      channelId: subscription.channelId,
      channelAvatarPath: subscription.channelAvatarPath,
      lastVideoThumbnailPath: subscription.lastVideoThumbnailPath
    })
    .from(subscription);

  for (const row of subs) {
    if (row.channelId) add(avatarName(row.channelId));
    addPath(row.channelAvatarPath);
    addPath(row.lastVideoThumbnailPath);

    // The subscription's copy was made from the shared one, which a download
    // of that video picks up again later; keep both.
    const sub = row.lastVideoThumbnailPath && ImagesService.nameOf(row.lastVideoThumbnailPath);
    const videoId = sub?.match(/^video-(.+)-sub\.jpg$/)?.[1];
    if (videoId) {
      add(subPosterName(videoId));
      add(`video-${videoId}.jpg`);
    }
  }

  return keep;
}

/** Images of ours that no row reads any more, with their sizes. */
async function findUnused(): Promise<{ file: string; size: number }[]> {
  let names: string[];

  try {
    names = await fsp.readdir(ImagesService.dir);
  } catch {
    return [];
  }

  const keep = await imagesInUse();
  const cutoff = Date.now() - GRACE_MS;
  const unused: { file: string; size: number }[] = [];

  for (const name of names) {
    if (!OWN_IMAGE.test(name) || keep.has(name)) continue;

    const file = path.join(ImagesService.dir, name);

    try {
      const stat = await fsp.stat(file);

      if (stat.isFile() && stat.mtimeMs < cutoff) unused.push({ file, size: stat.size });
    } catch {
      // Gone already.
    }
  }

  return unused;
}

const toResult = (files: { size: number }[]): CleanupResult => ({
  total: files.length,
  totalSizeKB: Math.round(files.reduce((sum, f) => sum + f.size, 0) / 1000)
});

/** What a cleanup would remove right now, without removing anything. */
export async function previewCleanup(): Promise<CleanupResult> {
  return toResult(await findUnused());
}

/**
 * Removes the unused images. The list is worked out again here rather than
 * taken from the preview, so a row added since then keeps its picture.
 */
export async function runCleanup(): Promise<CleanupResult> {
  const removed: { size: number }[] = [];

  for (const entry of await findUnused()) {
    try {
      await fsp.unlink(entry.file);
      removed.push(entry);
    } catch (e) {
      console.warn(`image-cleanup: could not remove ${entry.file}:`, e);
    }
  }

  const result = toResult(removed);

  console.log(`image-cleanup: removed ${result.total} images (${result.totalSizeKB} KB)`);

  return result;
}
