import { AudioFormats, Codecs, VideoQuality, Types, VideoFormats, AudioQuality } from './subscription.model';
import { Nullable } from './common.model';

export enum DownloadStatus {
  TOTAL = null,
  QUEUED = 'queued',
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

/**
 * Which site a download came from. Mirrors PLATFORMS in the backend's
 * services/platform.ts — keep the two in step when adding a site.
 */
export enum Platform {
  YOUTUBE = 'youtube',
  TIKTOK = 'tiktok',
  INSTAGRAM = 'instagram',
  /** A site yt-dlp handles but the app has no special knowledge of. */
  UNKNOWN = 'unknown',
}

export enum DownloadSource {
  /** Queued by an RSS scan of a watched channel. */
  WATCHER = 'watcher',
  /** Queued by hand from the Download-now form. */
  MANUAL = 'manual',
}

export interface DownloadModel {
  id: number;
  watcherId: Nullable<number>;
  channelId: Nullable<string>;
  channelName: Nullable<string>;
  videoId: Nullable<string>;
  title: Nullable<string>;
  url: string;
  status: DownloadStatus;
  source: DownloadSource;
  /** Which site the video came from; drives platform-specific links/artwork. */
  platform: Platform;
  /** Snapshot of the channel's settings when the download was queued. */
  type: Nullable<Types>;
  format: Nullable<VideoFormats | AudioFormats | 'jpg'>;
  codec: Nullable<Codecs>;
  /** Manual downloads only; watchers always take the best available. */
  quality: Nullable<VideoQuality | AudioQuality>;
  folder: Nullable<string>;
  prefix: Nullable<string>;
  ytdlpArgs: Nullable<string>;
  clipStart: Nullable<string>;
  clipEnd: Nullable<string>;
  removeSponsor: boolean;
  splitChapters: boolean;
  /** Set when the row came from expanding a playlist or channel URL. */
  playlistId: Nullable<string>;
  playlistTitle: Nullable<string>;
  playlistIndex: Nullable<number>;
  /** Video length in seconds; null for live streams. */
  duration: Nullable<number>;
  progress: number;
  speed: Nullable<string>;
  eta: Nullable<string>;
  totalBytes: Nullable<number>;
  filePath: Nullable<string>;
  avatarPath: Nullable<string>;
  thumbnailPath: Nullable<string>;
  authorUrl: Nullable<string>;
  error: Nullable<string>;
  createdAt: string;
  startedAt: Nullable<string>;
  finishedAt: Nullable<string>;
}

/** Body of POST /api/downloads — an ad-hoc download outside any channel. */
export interface ManualDownloadRequest {
  url: string;
  type: Types;
  format: VideoFormats | AudioFormats;
  codec: Codecs;
  quality: VideoQuality | AudioQuality;
  folder: Nullable<string>;
  prefix: Nullable<string>;
  ytdlpArgs: Nullable<string>;
  clipStart: Nullable<string>;
  clipEnd: Nullable<string>;
  removeSponsor: boolean;
  splitChapters: boolean;
}

export interface ManualDownloadResult {
  ok: boolean;
  /** What the pasted URL turned out to be. */
  kind: 'video' | 'playlist' | 'channel';
  playlistId: Nullable<string>;
  playlistTitle: Nullable<string>;
  queued: number;
  /** True when the source held more videos than the server will queue. */
  truncated: boolean;
  limit: number;
  downloads: DownloadModel[];
}

/** One page of download history, as `/api/downloads` returns it. */
export interface DownloadsPageModel {
  items: DownloadModel[];
  total: number;
  /** The page actually served, which is clamped to the last one that exists. */
  page: number;
  pages: number;
  limit: number;
}

/**
 * Counts across the whole history, as `/api/downloads/info` returns them —
 * not just the page on screen.
 *
 * Keyed by DownloadStatus itself rather than by prose names, so a count can be
 * read with the same value the list filters by: `info[status]` for a filtered
 * list, `info.total` for an unfiltered one. Adding a status to the enum is
 * therefore the only change a new status needs on this side.
 */
export type DownloadInfoModel = Record<DownloadStatus, number> & { total: number };
