import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import * as Ffmpeg from "./ffmpeg.js";
import { avatarFor } from "./avatar.js";
import { authorUrlFor } from "./author.js";
import { ImagesService } from "./images.service.js";

import type { Download } from "../db/types.js";

/**
 * Which picture a download row shows, and how one is made for a row that
 * arrived without any.
 *
 * posterFor() below answers the first question for every row the server hands
 * a client. The rest of the file answers the second:
 *
 * Most sites hand yt-dlp a thumbnail URL and the artwork cache fetches it —
 * see manual-download.ts. A bare manifest (`.../master.m3u8`) has no such
 * metadata: the generic extractor knows the stream and nothing else, so those
 * rows render the "Poster not found" placeholder forever. The video itself is
 * the only picture available, so take a frame out of it.
 *
 * ffmpeg can read the manifest directly, without downloading anything, but
 * that is exactly the path services/ffmpeg.ts exists to distrust — a
 * statically linked build segfaults the moment it resolves a hostname. A file
 * that already landed never touches the resolver, so the capture waits for
 * the download to finish and reads from disk.
 */

/**
 * A URL that points straight at a stream or a media file, rather than at a
 * page describing one. yt-dlp's generic extractor has no metadata to work
 * with here, so it names the video after the last path segment — which makes
 * `master.m3u8` and `index.m3u8` collide across completely unrelated
 * downloads. Artwork keyed on that id cannot be trusted to belong to this
 * row, so these always capture their own poster.
 */
const DIRECT_MEDIA_URL = /\.(m3u8|mpd|mp4|m4v|mov|mkv|webm|ts)(\?|#|$)/i;

/**
 * The picture a download row should show, as a path the browser can load, or
 * null when the row has none.
 *
 * Decided here rather than in the client: which file a row ends up with
 * depends on what actually landed in the images directory, which only the
 * server can see. The client used to guess `/images/video-<id>.jpg` for every
 * row and let the 404 fall through to a placeholder, so a row with no artwork
 * flickered through a broken image on the way there.
 *
 * Only real pictures of the video are ever returned — a platform thumbnail
 * or a frame grabbed out of the file, never a stand-in for one. A download
 * that has nothing yet usually has something coming: an audio download's
 * poster is cut from its video once the bytes land (see finishArtwork() in
 * download-queue.ts), so null here means "not yet", and the client holds a
 * preloader rather than settling on a picture that is about to be replaced.
 */
export function posterFor(row: Download): string | null {
  if (row.thumbnailPath) return row.thumbnailPath;

  if (hasCachedArtwork(row)) return `/images/video-${row.videoId}.jpg`;

  return null;
}

/** A row as a client sees it: stored columns plus the resolved extras. */
export type Decorated<T extends Download> = T & {
  avatarPath: string | null;
  authorUrl: string | null;
};

/**
 * A copy of `row` carrying the resolved extras, for handing to a client — its
 * poster, the uploader avatar from services/avatar.ts and the link to the
 * uploader from services/author.ts. The thumbnailPath column itself keeps its
 * narrower meaning — the row's own captured frame — so nothing on the server
 * mistakes a placeholder for a real file. avatarPath and authorUrl have no
 * columns at all: both are derived from what the row already carries, so
 * there is nothing to keep in step.
 *
 * Every path and link a client renders is resolved in this one place, which
 * is what lets the client render them directly instead of assembling URLs out
 * of per-site knowledge it would have to hold a second copy of.
 */
export function decorate<T extends Download>(row: T): Decorated<T> {
  return {
    ...row,
    thumbnailPath: posterFor(row),
    avatarPath: avatarFor(row),
    authorUrl: authorUrlFor(row)
  };
}

export function decorateAll<T extends Download>(rows: T[]): Decorated<T>[] {
  return rows.map(decorate);
}

/**
 * The image file behind a row's poster, when it is a real picture of the
 * video rather than a placeholder standing in for one. That distinction is
 * what separates this from posterFor(): a placeholder is fine to show in a
 * list and quite wrong to write into someone's audio file as its cover.
 */
export function fileFor(row: Download): string | null {
  const name = row.thumbnailPath
    ? path.basename(row.thumbnailPath)
    : hasCachedArtwork(row)
      ? `video-${row.videoId}.jpg`
      : null;

  if (!name || !ImagesService.exists(name)) return null;

  return ImagesService.pathFor(name);
}

/** Whether the shared artwork cache already holds a picture for this row. */
export function hasCachedArtwork(row: Download): boolean {
  if (!row.videoId) return false;
  if (DIRECT_MEDIA_URL.test(row.url)) return false;

  return ImagesService.exists(`video-${row.videoId}.jpg`);
}

/** Poster width; height follows the source aspect (`-2` keeps it even). */
const WIDTH = 640;

/**
 * Openings are frequently black or a fade-in, so seek in before grabbing.
 * A share of the runtime rather than a constant, so a 20-second clip is not
 * asked for a frame it does not have — capped, because 10% of a three-hour
 * stream is half an hour of seeking for no benefit.
 */
const SEEK_FRACTION = 0.1;
const SEEK_CAP_S = 30;

/** Used when the row never learned its duration (live streams). */
const SEEK_FALLBACK_S = 10;

const TIMEOUT_MS = 30_000;

/**
 * Below this the JPEG is not a picture. ffmpeg exits 0 after writing an empty
 * file when the seek lands past the last frame, which is the case the retry
 * at offset zero is there to rescue.
 */
const MIN_BYTES = 1024;

export type CaptureRequest = {
  /** Download row id; the poster is named after it. */
  id: number;
  /** The finished media file, as reported by yt-dlp. */
  filePath: string;
  /** Seconds, when known. */
  duration: number | null;
};

export function posterName(id: number): string {
  return `poster-${id}.jpg`;
}

/**
 * Writes `/images/poster-<id>.jpg` and returns its public path, or null when
 * no frame could be read. Never throws: a missing poster is cosmetic, and the
 * download it belongs to has already succeeded.
 */
export async function capture(req: CaptureRequest): Promise<string | null> {
  try {
    if (!isReadableFile(req.filePath)) return null;

    const bin = await Ffmpeg.binary();

    const filename = posterName(req.id);
    const target = ImagesService.pathFor(filename);

    // The seek is a guess about where a representative frame lives, so a miss
    // is expected rather than exceptional: fall back to the first frame,
    // which every file that decodes at all can produce.
    const offsets = [seekFor(req.duration), 0];

    for (const offset of offsets) {
      if (await frame(bin, req.filePath, offset, target)) {
        return `/images/${filename}`;
      }
    }

    // Nothing usable was written; leave no empty file behind for the static
    // route to serve as a broken image.
    discard(target);

    return null;
  } catch (e) {
    console.warn("Poster capture failed:", e);
    return null;
  }
}

/** Drops the poster for a download, if it has one. */
export function remove(id: number): void {
  void ImagesService.remove(posterName(id));
}

function seekFor(duration: number | null): number {
  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    return SEEK_FALLBACK_S;
  }

  return Math.min(duration * SEEK_FRACTION, SEEK_CAP_S);
}

/**
 * Decodes a single frame at `offset` into `target`. `-ss` goes before `-i` so
 * ffmpeg seeks by keyframe instead of decoding everything up to that point —
 * the difference between milliseconds and minutes on a long file.
 */
function frame(
  bin: string,
  source: string,
  offset: number,
  target: string
): Promise<boolean> {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-ss", offset.toFixed(3),
    "-i", source,
    "-frames:v", "1",
    "-vf", `scale=${WIDTH}:-2`,
    "-q:v", "3",
    "-y", target
  ];

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(bin, args, { stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);

    timer.unref();

    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });

    // The exit code is not enough on its own: a seek past the end of the file
    // exits 0 having written nothing, so the result is judged by what landed.
    child.on("close", () => {
      clearTimeout(timer);
      resolve(wrote(target));
    });
  });
}

function wrote(target: string): boolean {
  try {
    return fs.statSync(target).size >= MIN_BYTES;
  } catch {
    return false;
  }
}

function isReadableFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function discard(target: string): void {
  try {
    fs.rmSync(target, { force: true });
  } catch {
    // Nothing to clean up.
  }
}
