import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import * as Ffmpeg from "./ffmpeg.js";
import { CODEC_LABELS } from "../models/media-options.js";

/**
 * A codec choice is a request for what the file on disk carries, but yt-dlp's
 * format selector can only pick from what the site offers — and YouTube does
 * not offer H.265 at all. Selection falls back to the best stream in any
 * codec rather than failing, and this re-encodes it into the one asked for.
 *
 * Only the main video stream is re-encoded; audio, subtitles and cover art
 * are copied as they are.
 */

/** Software encoders, best first. Hardware ones depend on the host's GPU. */
const ENCODERS: Record<string, { encoder: string; args: string[] }[]> = {
  h264: [
    // yuv420p because a 10-bit source otherwise becomes High 10, which
    // almost nothing plays in hardware.
    { encoder: "libx264", args: ["-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"] }
  ],
  h265: [
    // hvc1 is the tag Apple players insist on; ffmpeg writes hev1 otherwise.
    { encoder: "libx265", args: ["-preset", "medium", "-crf", "22", "-tag:v", "hvc1"] }
  ],
  av1: [
    { encoder: "libsvtav1", args: ["-preset", "8", "-crf", "32"] },
    { encoder: "libaom-av1", args: ["-cpu-used", "6", "-row-mt", "1", "-crf", "32", "-b:v", "0"] }
  ],
  vp9: [
    { encoder: "libvpx-vp9", args: ["-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-crf", "32", "-b:v", "0"] }
  ]
};

/** WebM only holds VP8, VP9 and AV1; anything else moves to Matroska. */
const WEBM_CODECS = new Set(["vp9", "av1"]);

export const LABELS = CODEC_LABELS;

let available: Promise<Set<string>> | null = null;

/** Whether `probed` is something other than the codec explicitly asked for. */
export function needed(requested: string | null | undefined, probed: string | null): boolean {
  if (!requested || !ENCODERS[requested]) return false;

  // A failed probe says nothing, and re-encoding blind could make things worse.
  return !!probed && probed !== requested;
}

export type TranscodeResult =
  | { ok: true; filePath: string }
  | { ok: false; canceled: boolean; error: string };

/**
 * Re-encodes `source` into `codec`. The result is built beside the source and
 * replaces it only once ffmpeg has finished, so a failure or a cancel leaves
 * the download as it was. The path can change: WebM cannot carry H.264/H.265.
 *
 * `onSpawn` hands over the child so the queue can cancel it like a download.
 */
export async function run(
  source: string,
  codec: string,
  duration: number | null,
  onSpawn: (child: ChildProcess) => void,
  onProgress: (progress: number, eta: number | null) => void
): Promise<TranscodeResult> {
  const choice = await pickEncoder(codec);

  if (!choice) {
    const names = (ENCODERS[codec] ?? []).map((e) => e.encoder).join(" or ");

    return {
      ok: false,
      canceled: false,
      error: `ffmpeg has no ${LABELS[codec] ?? codec} encoder (needs ${names})`
    };
  }

  const ext = path.extname(source);
  const targetExt =
    ext.toLowerCase() === ".webm" && !WEBM_CODECS.has(codec) ? ".mkv" : ext;
  const base = source.slice(0, -ext.length);
  const staged = `${base}.transcode-tmp${targetExt}`;
  const target = `${base}${targetExt}`;

  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-nostats",
    "-progress", "pipe:1",
    "-i", source,
    "-map", "0",
    "-c", "copy",
    // "V" skips attached pictures, so cover art stays an image.
    "-c:V", choice.encoder,
    ...choice.args,
    ...(targetExt === ".mp4" || targetExt === ".m4v" || targetExt === ".mov"
      ? ["-movflags", "+faststart"]
      : []),
    "-y", staged
  ];

  const result = await spawnFfmpeg(await Ffmpeg.binary(), args, duration, onSpawn, onProgress);

  if (!result.ok) {
    await discard(staged);
    return result;
  }

  try {
    await fsp.rename(staged, target);

    if (target !== source) await discard(source);

    return { ok: true, filePath: target };
  } catch (e) {
    await discard(staged);

    return { ok: false, canceled: false, error: `Could not replace the file: ${(e as Error).message}` };
  }
}

async function pickEncoder(codec: string) {
  const encoders = await listEncoders();

  return (ENCODERS[codec] ?? []).find((e) => encoders.has(e.encoder)) ?? null;
}

/** Encoder names this ffmpeg was built with, asked once per process. */
function listEncoders(): Promise<Set<string>> {
  available ??= (async () => {
    const bin = await Ffmpeg.binary();

    return new Promise<Set<string>>((resolve) => {
      let output = "";
      let child: ChildProcess;

      try {
        child = spawn(bin, ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        resolve(new Set());
        return;
      }

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => (output += chunk));
      child.on("error", () => resolve(new Set()));
      child.on("close", () => {
        // " V....D libx264   libx264 H.264 / AVC ..." — the second column.
        const names = output
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/)[1])
          .filter((name): name is string => !!name);

        resolve(new Set(names));
      });
    });
  })();

  // A failed listing should not stick for the life of the process.
  void available.then((set) => {
    if (!set.size) available = null;
  });

  return available;
}

function spawnFfmpeg(
  bin: string,
  args: string[],
  duration: number | null,
  onSpawn: (child: ChildProcess) => void,
  onProgress: (progress: number, eta: number | null) => void
): Promise<TranscodeResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;

    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, canceled: false, error: `ffmpeg failed to start: ${(e as Error).message}` });
      return;
    }

    onSpawn(child);

    let stderrTail = "";
    let block: Record<string, string> = {};

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      // -progress writes key=value lines, ending each report with progress=.
      for (const line of chunk.split(/\r?\n/)) {
        const eq = line.indexOf("=");

        if (eq < 0) continue;

        const key = line.slice(0, eq).trim();
        block[key] = line.slice(eq + 1).trim();

        if (key !== "progress") continue;

        report(block, duration, onProgress);
        block = {};
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000);
    });

    child.on("error", (e) => {
      stderrTail = `${stderrTail}\n${e.message}`.trim();
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ ok: true, filePath: "" });
        return;
      }

      const last = stderrTail.trim().split(/\r?\n/).pop();

      resolve({
        ok: false,
        canceled: signal === "SIGTERM",
        error: `ffmpeg conversion failed: ${last || (signal ? `killed by ${signal}` : `exit code ${code}`)}`
      });
    });
  });
}

function report(
  block: Record<string, string>,
  duration: number | null,
  onProgress: (progress: number, eta: number | null) => void
) {
  if (!duration) return;

  // out_time_us is microseconds despite the older out_time_ms name.
  const done = Number(block.out_time_us ?? block.out_time_ms) / 1e6;

  if (!Number.isFinite(done) || done < 0) return;

  const progress = Math.min(99, Math.round((done / duration) * 100));
  const speed = parseFloat(block.speed ?? "");
  const eta = speed > 0 ? Math.max(0, (duration - done) / speed) : null;

  onProgress(progress, eta);
}

async function discard(target: string): Promise<void> {
  if (!fs.existsSync(target)) return;

  try {
    await fsp.rm(target, { force: true });
  } catch {
    // Nothing to clean up.
  }
}
