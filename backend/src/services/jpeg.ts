import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";

import * as Ffmpeg from "./ffmpeg.js";

/**
 * Turns whatever picture it is given into a real baseline JPEG.
 *
 * Two callers need that. Uploaded avatars and posters arrive as PNG or WebP
 * but are stored under the `.jpg` names the rest of the app already looks
 * for. And video cover art is copied into the file as it is (see
 * cover-art.ts), where a WebP saved under a `.jpg` name — which the artwork
 * cache is full of, since YouTube serves hq720 as WebP whatever the URL says
 * — would make the muxer refuse the picture.
 *
 * 4:2:0 at the highest JPEG quality, the same as the audio cover-art mux, so
 * every player's decoder accepts it.
 */

const TIMEOUT_MS = 30_000;

export type Fit =
  /** Kept as it is. */
  | { kind: "none" }
  /** Narrowed to at most this width; height follows the aspect. */
  | { kind: "width"; max: number }
  /** Shrunk to fit inside a square of this side, never cropped. */
  | { kind: "box"; max: number };

/**
 * Writes `source` as a JPEG at `target`. The picture is built beside the
 * target and moved over it only once ffmpeg is done, so a failure never
 * leaves the old file half overwritten — which matters for an avatar that
 * every row of a channel is showing. Never throws.
 */
export async function convert(
  source: string,
  target: string,
  fit: Fit = { kind: "none" }
): Promise<boolean> {
  // Unique, so two uploads of one channel's avatar at once cannot write
  // into each other's half-finished file.
  const staged = `${target}.${crypto.randomUUID()}.tmp`;

  try {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",
      "-i", source,
      "-frames:v", "1",
      // Never upscaled: a small picture stays small rather than blurry.
      // Even sides, which 4:2:0 needs.
      ...filterFor(fit),
      "-c:v", "mjpeg",
      "-q:v", "2",
      "-pix_fmt", "yuvj420p",
      // The staged name does not end in .jpg, so say what to write.
      "-f", "image2",
      "-update", "1",
      "-y", staged
    ];

    if (!(await run(await Ffmpeg.binary(), args)) || !nonEmpty(staged)) {
      await discard(staged);
      return false;
    }

    await fsp.rename(staged, target);

    return true;
  } catch (e) {
    console.warn("JPEG conversion failed:", e);
    await discard(staged);

    return false;
  }
}

function filterFor(fit: Fit): string[] {
  switch (fit.kind) {
    case "width":
      return ["-vf", `scale='trunc(min(${fit.max},iw)/2)*2':-2`];
    case "box":
      return [
        "-vf",
        `scale='min(${fit.max},iw)':'min(${fit.max},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
      ];
    default:
      return ["-vf", "scale='trunc(iw/2)*2':'trunc(ih/2)*2'"];
  }
}

function run(bin: string, args: string[]): Promise<boolean> {
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
      resolve(code === 0);
    });
  });
}

function nonEmpty(target: string): boolean {
  try {
    return fs.statSync(target).size > 0;
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
