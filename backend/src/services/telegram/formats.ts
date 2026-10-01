import { resolutionLabel } from "../media-quality.js";
import { QUALITY_HEIGHTS } from "../../models/media-options.js";

/**
 * What the bot offers for one video: a button per resolution that an
 * "mp4 + H.264" download can actually produce, and MP3. Worked out from the
 * formats yt-dlp listed during the resolve, by following the same preference
 * as the format selector in ytdlp.ts — H.264 first, mp4 first, under the
 * height cap — so the size shown is the size of what will be downloaded.
 */

type Format = {
  format_id?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
};

export type VideoOption = {
  /** A value from VIDEO_QUALITIES, which is what the queue is given. */
  quality: string;
  /** "1080p", read off the picked format the way the UI labels files. */
  label: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  /** No H.264 stream at this size, so the file is converted after download. */
  reencode: boolean;
};

/** `--audio-quality 0` for mp3 is LAME V0, which averages about this. */
const MP3_KBPS = 245;

/** Caps from the top: null is "best", then every capped quality. */
const CAPS: Array<[string, number | null]> = [
  ["best", null],
  ...Object.entries(QUALITY_HEIGHTS).sort((a, b) => b[1] - a[1])
];

const hasVideo = (f: Format) => !!f.vcodec && f.vcodec !== "none" && (f.height ?? 0) > 0;
const hasAudio = (f: Format) => !!f.acodec && f.acodec !== "none";
const isAvc = (f: Format) => /^(avc|h264)/i.test(f.vcodec ?? "");

function sizeOf(f: Format, duration: number | null): number | null {
  const known = f.filesize ?? f.filesize_approx;

  if (known) return known;

  // Total bitrate is in kbit/s.
  return f.tbr && duration ? Math.round(f.tbr * 125 * duration) : null;
}

/**
 * yt-dlp's own ranking, roughly: tallest first, then a video-only stream
 * over a ready-made one with audio (its DASH streams win at the same height),
 * then the higher bitrate.
 */
function best(list: Format[]): Format | null {
  return list.reduce<Format | null>((top, f) => {
    if (!top) return f;
    if ((f.height ?? 0) !== (top.height ?? 0)) return (f.height ?? 0) > (top.height ?? 0) ? f : top;
    if (hasAudio(f) !== hasAudio(top)) return hasAudio(f) ? top : f;

    return (f.tbr ?? 0) > (top.tbr ?? 0) ? f : top;
  }, null);
}

function pickVideo(videos: Format[], cap: number | null): Format | null {
  const within = cap ? videos.filter((f) => (f.height ?? 0) <= cap) : videos;
  const mp4 = (f: Format) => f.ext === "mp4";

  const tiers = [
    within.filter((f) => isAvc(f) && mp4(f)),
    within.filter(isAvc),
    within.filter(mp4),
    within
  ];

  return best(tiers.find((tier) => tier.length) ?? []);
}

function pickAudio(formats: Format[]): Format | null {
  const audios = formats.filter((f) => hasAudio(f) && !hasVideo(f));
  const m4a = audios.filter((f) => f.ext === "m4a");

  return (m4a.length ? m4a : audios).reduce<Format | null>(
    (top, f) => (!top || (f.tbr ?? 0) > (top.tbr ?? 0) ? f : top),
    null
  );
}

export function videoOptions(info: any): VideoOption[] {
  const formats: Format[] = Array.isArray(info?.formats) ? info.formats : [];
  const duration = typeof info?.duration === "number" ? info.duration : null;

  const videos = formats.filter(hasVideo);
  const audio = pickAudio(formats);

  const options: VideoOption[] = [];
  const seen = new Set<string>();

  for (const [quality, cap] of CAPS) {
    const pick = pickVideo(videos, cap);

    if (!pick) continue;

    const label = resolutionLabel(pick.width, pick.height) ?? `${pick.height}p`;

    // Several caps land on the same stream - every cap above 1080p does on
    // YouTube, whose H.264 stops there. One button per distinct result.
    if (seen.has(pick.format_id ?? label) || seen.has(label)) continue;

    seen.add(pick.format_id ?? label);
    seen.add(label);

    const videoBytes = sizeOf(pick, duration);
    const audioBytes = hasAudio(pick) ? 0 : audio ? sizeOf(audio, duration) : null;

    options.push({
      quality,
      label,
      bytes: videoBytes != null && audioBytes != null ? videoBytes + audioBytes : null,
      width: pick.width ?? null,
      height: pick.height ?? null,
      reencode: !isAvc(pick)
    });
  }

  return options;
}

export function mp3Bytes(info: any): number | null {
  const duration = typeof info?.duration === "number" ? info.duration : null;

  return duration ? Math.round(duration * MP3_KBPS * 125) : null;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "size unknown";

  const mb = bytes / (1024 * 1024);

  return mb >= 1024 ? `~${(mb / 1024).toFixed(1)} GB` : `~${Math.max(1, Math.round(mb))} MB`;
}
