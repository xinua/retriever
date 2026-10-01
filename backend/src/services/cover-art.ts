import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import * as Ffmpeg from "./ffmpeg.js";
import * as Jpeg from "./jpeg.js";

/**
 * Writes a download's poster into the media file itself, so the picture the
 * Downloads list shows is the cover art a music player or a file manager
 * shows.
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
 */
const AUDIO = new Set([".mp3", ".m4a", ".flac"]);

/**
 * Video containers that hold a cover. MP4 stores it as a `covr` atom and
 * Matroska as an attachment named cover.jpg, which is where Jellyfin, Kodi
 * and Plex look. WebM's spec allows no attachments and ffmpeg refuses to
 * write one, and the QuickTime muxer drops the picture without a word, so
 * .webm and .mov are left alone.
 */
const MP4 = new Set([".mp4", ".m4v"]);
const MKV = new Set([".mkv"]);

/** Audio is small; a video remux is a copy of however many GB it is. */
const AUDIO_TIMEOUT_MS = 120_000;
const VIDEO_TIMEOUT_MS = 15 * 60_000;

export function supports(mediaPath: string): boolean {
  const ext = path.extname(mediaPath).toLowerCase();

  return AUDIO.has(ext) || MP4.has(ext) || MKV.has(ext);
}

/**
 * Whether the file already carries a cover — put there by yt-dlp when the
 * user added `--embed-thumbnail` to their args, say. Reads the header only,
 * so it costs milliseconds whatever the file's size. False when the file
 * cannot be probed: not knowing is no reason to skip the cover.
 */
export async function hasCover(mediaPath: string): Promise<boolean> {
  const args = [
    "-v", "error",
    "-select_streams", "v",
    "-show_entries", "stream_disposition=attached_pic",
    "-of", "csv=p=0",
    mediaPath
  ];

  const bin = await Ffmpeg.probeBinary();

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    let out = "";

    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);

    timer.unref();

    child.stdout?.on("data", (chunk) => (out += chunk));

    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });

    // One line per video stream, "1" for each that is an attached picture.
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && out.split(/\r?\n/).some((line) => line.trim() === "1"));
    });
  });
}

/**
 * Muxes `imagePath` into `mediaPath` as its cover, replacing any cover it
 * already had.
 *
 * Every stream is copied rather than re-encoded, so this rewrites the
 * container and the picture and nothing else — for a video that is the cost
 * of copying the file once. The new file is built beside the old one and
 * moved over it only once ffmpeg is happy, so a failure — a codec the muxer
 * refuses, a truncated jpg, a killed process — leaves the download exactly as
 * it was.
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
  let scratch: string | null = null;

  try {
    if (!isReadableFile(mediaPath) || !isReadableFile(imagePath)) return false;

    const bin = await Ffmpeg.binary();
    const lower = ext.toLowerCase();
    let ok: boolean;

    if (AUDIO.has(lower)) {
      ok = await run(bin, audioArgs(mediaPath, imagePath, staged), AUDIO_TIMEOUT_MS, staged);
    } else {
      // A video's streams are all copied, the picture included, so it has to
      // be a real JPEG before it goes in — see jpeg.ts. Converted outside the
      // download folder, so nothing extra shows up next to the user's files.
      scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "retriever-cover-"));

      const cover = path.join(scratch, "cover.jpg");

      if (!(await Jpeg.convert(imagePath, cover))) return false;

      const args = MP4.has(lower)
        ? mp4Args(mediaPath, cover, staged)
        : mkvArgs(mediaPath, cover, staged);

      ok = await run(bin, args, VIDEO_TIMEOUT_MS, staged);
    }

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
  } finally {
    if (scratch) await fsp.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

function audioArgs(media: string, image: string, target: string): string[] {
  return [
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
}

/**
 * `0:V` (capital) is every video stream that is not itself a cover, which is
 * how a previous cover — ours, from an earlier replace, or one yt-dlp put
 * there — is left behind instead of piling up. The picture is mapped first so
 * its output index is known whatever the file carries; the muxer writes it
 * as a `covr` atom rather than a track, so the order is not visible to
 * players. Global tags and chapters follow the first input on their own.
 */
function mp4Args(media: string, cover: string, target: string): string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-i", media,
    "-i", cover,
    "-map", "1:v",
    "-map", "0:V",
    "-map", "0:a?",
    "-map", "0:s?",
    "-c", "copy",
    "-disposition:v:0", "attached_pic",
    // Keeps the index at the front, as yt-dlp's own merge leaves it, so the
    // in-page player can start before it has the whole file.
    "-movflags", "+faststart",
    "-y", target
  ];
}

/**
 * ffmpeg reads a Matroska picture attachment back as an attached-picture
 * video stream, so `0:V` drops an old cover here too, while `0:t` keeps any
 * other attachment — fonts for styled subtitles.
 */
function mkvArgs(media: string, cover: string, target: string): string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-i", media,
    "-map", "0:V",
    "-map", "0:a?",
    "-map", "0:s?",
    "-map", "0:t?",
    "-c", "copy",
    "-attach", cover,
    // The muxer refuses an attachment without a mimetype. `-attach` names the
    // stream after the file, so it is picked out by that name — an index
    // would land on a font whenever the file already carries one.
    "-metadata:s:t:m:filename:cover.jpg", "mimetype=image/jpeg",
    "-y", target
  ];
}

function run(
  bin: string,
  args: string[],
  timeoutMs: number,
  target: string
): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(bin, args, { stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

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
