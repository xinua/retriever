/**
 * The download options the app accepts: one list per choice, used both to
 * validate requests (routes/http/downloads.ts), to build yt-dlp arguments
 * (services/ytdlp.ts) and to offer choices in the Telegram bot. The values
 * mirror the frontend enums, which are kept separately.
 */

export const VIDEO_FORMATS = ["auto", "mp4", "mkv"] as const;

export const AUDIO_FORMATS = ["auto", "m4a", "mp3", "opus", "wav", "flac"] as const;

export const CODECS = ["auto", "h264", "h265", "av1", "vp9"] as const;

/**
 * Video quality is a resolution ceiling, audio quality a target bitrate. The
 * two vocabularies overlap only on "best", so which one a request is checked
 * against depends on its type.
 */
export const VIDEO_QUALITIES = [
  "best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "worst"
] as const;

export const AUDIO_QUALITIES = ["best", "320kbps", "192kbps", "128kbps"] as const;

/**
 * A bitrate target means nothing to a lossless codec — ffmpeg accepts -b:a
 * there and ignores it — so these formats are always encoded at best effort.
 */
export const LOSSLESS_AUDIO_FORMATS = ["wav", "flac"] as const;

/** The height each capped video quality stands for. */
export const QUALITY_HEIGHTS: Record<string, number> = {
  "2160p": 2160,
  "1440p": 1440,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
  "360p": 360,
  "240p": 240
};

export const CODEC_LABELS: Record<string, string> = {
  auto: "Auto",
  h264: "H.264",
  h265: "H.265",
  av1: "AV1",
  vp9: "VP9"
};

/** Formats read as upper-case extensions everywhere but "auto". */
export function formatLabel(format: string): string {
  return format === "auto" ? "Auto" : format.toUpperCase();
}

export function qualityLabel(quality: string): string {
  return quality === "best" ? "Best" : quality === "worst" ? "Worst" : quality;
}

export function isLosslessAudio(format: string | null | undefined): boolean {
  return (LOSSLESS_AUDIO_FORMATS as readonly string[]).includes(format ?? "");
}
