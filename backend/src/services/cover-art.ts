import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import * as Ffmpeg from "./ffmpeg.js";

/**
 * Writes a download's poster into the audio file itself, so the picture the
 * Downloads list shows is the cover art a music player shows.
 *
 * yt-dlp has --embed-thumbnail for this, but it can only embed a thumbnail an
 * extractor handed it — which is exactly what the downloads that need this
 * most do not have. A bare .m3u8 stream ripped to mp3 has no artwork
 * anywhere, and its poster is a frame this app grabbed out of the video (see
 * poster.ts). Embedding here rather than there means one path for both: the
 * row's poster goes into the file, wherever it came from.
 */

/**
 * Audio containers whose muxers accept a still image as an attached picture.
 * Ogg and Opus carry cover art as a base64 comment block that ffmpeg cannot
 * write, and WAV has nowhere to put one at all — both are left as they are.
 *
 * Audio only, deliberately: the mux below keeps one audio stream and the
 * picture, which is cover art on an .m4a and the loss of the video on an
 * .mp4 that shares the container.
 */
const EMBEDDABLE = new Set([".mp3", ".m4a", ".flac"]);

const TIMEOUT_MS = 120_000;

export function supports(mediaPath: string): boolean {
  return EMBEDDABLE.has(path.extname(mediaPath).toLowerCase());
}

/**
 * Muxes `imagePath` into `mediaPath` as its cover.
 *
 * The audio is copied rather than re-encoded, so this rewrites the container
 * and the picture and nothing else. The new file is built beside the old one and moved over
 * it only once ffmpeg is happy, so a failure — a codec the muxer refuses, a
 * truncated jpg, a killed process — leaves the download exactly as it was.
 *
 * Never throws: cover art is a finishing touch on a download that already
 * succeeded.
 */
export async function embed(
  mediaPath: string,
  imagePath: string
): Promise<boolean> {
  if (!supports(mediaPath)) return false;

  const ext = path.extname(mediaPath);
  const staged = `${mediaPath.slice(0, -ext.length)}.cover-tmp${ext}`;

  try {
    if (!isReadableFile(mediaPath) || !isReadableFile(imagePath)) return false;

    const ok = await run(await Ffmpeg.binary(), mediaPath, imagePath, staged);

    if (!ok) {
      await discard(staged);
      return false;
    }

    await fsp.rename(staged, mediaPath);

    return true;
  } catch (e) {
    console.warn("Cover art failed:", e);
    await discard(staged);

    return false;
  }
}

function run(
  bin: string,
  media: string,
  image: string,
  target: string
): Promise<boolean> {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-i", media,
    "-i", image,
    // Only the audio: a file that already carries a cover would otherwise
    // keep the old picture alongside the new one.
    "-map", "0:a",
    "-map", "1:v",
    "-c:a", "copy",
    // The picture is re-encoded rather than copied: an attached picture has
    // to be JPEG or PNG, and the artwork cache is full of WebP saved under a
    // .jpg name — YouTube serves hq720 and maxresdefault as WebP whatever the
    // URL says, and only the RSS feed's hqdefault is a real JPEG. Copying a
    // WebP stream makes the mp3 muxer refuse the whole file, silently, so
    // the download ends up with no cover at all. Highest JPEG quality and
    // 4:2:0 subsampling, which every player's decoder accepts.
    "-c:v", "mjpeg",
    "-q:v", "2",
    "-pix_fmt", "yuvj420p",
    // Without this the picture is a one-frame video stream, and players show
    // it as a video track rather than as artwork.
    "-disposition:v:0", "attached_pic",
    // ID3v2.3 is what Windows and older players read; ffmpeg defaults to 2.4.
    // Ignored by every other muxer here.
    "-id3v2_version", "3",
    "-metadata:s:v", "title=Album cover",
    "-metadata:s:v", "comment=Cover (front)",
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

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && isReadableFile(target));
    });
  });
}

function isReadableFile(target: string): boolean {
  try {
    const stat = fs.statSync(target);

    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function discard(target: string): Promise<void> {
  try {
    await fsp.rm(target, { force: true });
  } catch {
    // Nothing to clean up.
  }
}
