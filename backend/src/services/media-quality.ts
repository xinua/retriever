import fs from "node:fs";
import { spawn } from "node:child_process";

import * as Ffmpeg from "./ffmpeg.js";

/**
 * What a finished file actually is, as opposed to what was asked for. A
 * subscription never asks for a quality, a manual download mostly asks for
 * "best", and a codec is usually left on "auto" — none of which says what
 * landed on disk. So the file is probed once it is there: a video is
 * labelled by its resolution ("1080p") and its video codec ("h265"), audio
 * by its bitrate ("320kbps").
 *
 * Best effort: a probe that fails leaves the labels null, and the UI falls
 * back to what was requested.
 */

const TIMEOUT_MS = 15000;

/** Output is a few hundred bytes; anything past this is not ffprobe JSON. */
const MAX_OUTPUT = 64 * 1024;

/**
 * Resolutions a label snaps to, so a 1920x1078 encode still reads "1080p".
 * Anything further off than SNAP_TOLERANCE keeps its own number.
 */
const RESOLUTIONS = [144, 240, 360, 480, 540, 576, 720, 1080, 1440, 2160, 4320];

/** Bitrates a label snaps to — a 128 kbps AAC stream measures 129 or 130. */
const BITRATES = [32, 48, 64, 96, 128, 160, 192, 256, 320];

const SNAP_TOLERANCE = 0.04;

/**
 * ffprobe names a codec after the decoder it uses, which is not how the app
 * spells the same codec anywhere else — the request, the format filter and
 * the UI all say "h265". Anything not listed keeps the name ffprobe gave it,
 * so an unusual encode still reads as something rather than nothing.
 */
const CODEC_NAMES: Record<string, string> = {
  h264: "h264",
  avc1: "h264",
  hevc: "h265",
  h265: "h265",
  av1: "av1",
  vp9: "vp9",
  vp8: "vp8"
};

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  bit_rate?: string;
  disposition?: { attached_pic?: number };
};

type ProbeResult = {
  streams?: ProbeStream[];
  format?: { bit_rate?: string };
};

/** What a probe could tell about a file; either half can be null. */
export type MediaInfo = {
  /** "1080p" for a video, "320kbps" for audio. */
  quality: string | null;
  /** The video codec, for video files only — audio has no picture to label. */
  codec: string | null;
};

const UNKNOWN: MediaInfo = { quality: null, codec: null };

/** The labels for the file at `filePath`, as far as they can be told. */
export async function probe(
  filePath: string | null,
  type: string | null
): Promise<MediaInfo> {
  if (!filePath || (type !== "video" && type !== "audio")) return UNKNOWN;
  if (!isReadableFile(filePath)) return UNKNOWN;

  const result = await run(filePath);

  if (!result) return UNKNOWN;

  // Cover art rides along as a video stream flagged attached_pic — it says
  // nothing about the media, and on an audio file it is the only one there.
  const streams = (result.streams ?? []).filter(
    (s) => !s.disposition?.attached_pic
  );

  const video = type === "video"
    ? streams.find((s) => s.codec_type === "video")
    : undefined;

  const codec = video ? codecLabel(video.codec_name) : null;

  if (video) {
    const label = resolutionLabel(video.width, video.height);

    if (label) return { quality: label, codec };
  }

  const audio = streams.find((s) => s.codec_type === "audio");

  if (!audio) return { quality: null, codec };

  // Ogg and WebM keep no per-stream bitrate, so fall back to the container's.
  // Close enough for an audio-only file; a video file never gets this far
  // unless it had no picture to label.
  const bps = num(audio.bit_rate) ?? num(result.format?.bit_rate);

  return { quality: bps ? bitrateLabel(bps) : null, codec };
}

function codecLabel(name: string | undefined): string | null {
  const probed = name?.trim().toLowerCase();

  if (!probed) return null;

  return CODEC_NAMES[probed] ?? probed;
}

/**
 * Labelled the way players label them: by the short side for a vertical
 * video, and by the width for a letterboxed one — a 1920x800 film is still
 * "1080p".
 */
function resolutionLabel(width?: number, height?: number): string | null {
  if (!width || !height) return null;

  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const lines = Math.max(short, Math.round((long * 9) / 16));

  return `${snap(lines, RESOLUTIONS)}p`;
}

function bitrateLabel(bps: number): string {
  return `${snap(Math.round(bps / 1000), BITRATES)}kbps`;
}

function snap(value: number, ladder: number[]): number {
  const nearest = ladder.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best
  );

  return Math.abs(nearest - value) <= nearest * SNAP_TOLERANCE ? nearest : value;
}

function num(value: string | undefined): number | null {
  const n = Number(value);

  return Number.isFinite(n) && n > 0 ? n : null;
}

function isReadableFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

async function run(filePath: string): Promise<ProbeResult | null> {
  const bin = await Ffmpeg.probeBinary();

  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,bit_rate:stream_disposition=attached_pic:format=bit_rate",
    filePath
  ];

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }

    let output = "";

    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);

    timer.unref();

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (output.length < MAX_OUTPUT) output += chunk;
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(output) as ProbeResult);
      } catch {
        resolve(null);
      }
    });
  });
}
