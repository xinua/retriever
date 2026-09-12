import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),

  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .default(true),

  webhookUrl: text("webhookUrl"),

  downloadsDir: text("downloadsDir").default("/downloads"),
  cookiesPath: text("cookiesPath"),
  ytdlpArgs: text("ytdlpArgs"),

  ytdlpConcurrency: integer("ytdlpConcurrency").notNull().default(2),

  createdAt: text("createdAt")
    .notNull()
    .default(sql`(datetime('now'))`),

  updatedAt: text("updatedAt")
    .notNull()
    .default(sql`(datetime('now'))`)
});

/**
 * Singleton, like `settings` - one row, id 1. Separate table rather than extra
 * columns on `settings` because this is presentation state: it is read on every
 * page load, written whenever someone nudges a control in the theme dialog, and
 * has nothing to do with how downloads behave.
 *
 * The enum-ish columns are plain TEXT and are validated in the route against
 * BG_TYPES / THEME_COLORS, so adding a colour does not need a migration.
 */
export const uiConfig = sqliteTable("ui_config", {
  id: integer("id").primaryKey().default(1),

  sectionsBg: text("sectionsBg").notNull().default("glass"),
  themeColor: text("themeColor").notNull().default("red"),

  enableAnimations: integer("enableAnimations", { mode: "boolean" })
    .notNull()
    .default(true),

  autoPaste: integer("autoPaste", { mode: "boolean" }).notNull().default(false),

  createdAt: text("createdAt")
    .notNull()
    .default(sql`(datetime('now'))`),

  updatedAt: text("updatedAt")
    .notNull()
    .default(sql`(datetime('now'))`)
});

/**
 * Singleton, like `settings`. Holds the last answer from the published
 * version manifest plus the instant the next check is due, so the schedule
 * survives a restart: the container comes back up, reads `nextCheckAt`, and
 * waits instead of asking GitHub again. See services/version-check.ts.
 */
export const versionCheck = sqliteTable("version_check", {
  id: integer("id").primaryKey().default(1),

  latestVersion: text("latestVersion"),
  releaseDate: text("releaseDate"),

  // The manifest verbatim, so the changelog is served without the schema
  // having to know its shape.
  payload: text("payload"),

  // Last successful fetch; `lastAttemptAt` also moves on a failed one.
  checkedAt: text("checkedAt"),
  lastAttemptAt: text("lastAttemptAt"),
  lastError: text("lastError"),

  nextCheckAt: text("nextCheckAt"),

  createdAt: text("createdAt")
    .notNull()
    .default(sql`(datetime('now'))`),

  updatedAt: text("updatedAt")
    .notNull()
    .default(sql`(datetime('now'))`)
});

export const channelGroup = sqliteTable("channel_group", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sortOrder: integer("sortOrder").notNull().default(0),
  color: text("color").default("#ffffff"),
  icon: text("icon"),

  createdAt: text("createdAt")
    .notNull()
    .default(sql`(datetime('now'))`),

  updatedAt: text("updatedAt")
    .notNull()
    .default(sql`(datetime('now'))`)
});

export const channel = sqliteTable("channel", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("groupId").references(() => channelGroup.id, { onDelete: "set null" }),
  name: text("name"),
  channelId: text("channelId"),
  channelDescription: text("channelDescription"),
  channelAvatarPath: text("channelAvatarPath"),
  sortOrder: integer("sortOrder").notNull().default(0),
  color: text("color"),
  rssUrl: text("rssUrl").notNull(),

  type: text("type").notNull(),
  format: text("format").notNull(),
  codec: text("codec"),

  ytdlpArgs: text("ytdlpArgs"),

  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .default(true),

  startFromLast: integer("startFromLast", { mode: "boolean" })
    .notNull()
    .default(true),

  downloadShorts: integer("downloadShorts", { mode: "boolean" })
    .notNull()
    .default(false),

  notifyHA: integer("notifyHA", { mode: "boolean" })
    .notNull()
    .default(false),

  splitChapters: integer("splitChapters", { mode: "boolean" })
    .notNull()
    .default(false),

  removeSponsors: integer("removeSponsors", { mode: "boolean" })
    .notNull()
    .default(false),

  pollType: text("pollType").notNull().default("interval"),
  pollInterval: integer("pollInterval"),

  /**
   * "Poll once a day": after the subscription captures a video, it is held
   * until the next day rather than polled again - the schedule skips ahead to
   * tomorrow's first slot. `lastCaptureAt` is what "captured" means here, so
   * the hold survives a restart and is decided the same way wherever it is
   * read - see schedule.helper.ts.
   */
  pollOnce: integer("pollOnce", { mode: "boolean" })
    .notNull()
    .default(false),

  /**
   * "time" polling: the wall-clock hours to poll at, as `["09:00", "18:00"]`.
   * JSON rather than a child table because it is only ever read and written
   * whole, alongside the row. Hours are read against the server's local
   * clock, so `TZ` decides what "09:00" means - see schedule.helper.ts.
   */
  pollTime: text("pollTime", { mode: "json" }).$type<string[]>(),

  /**
   * "interval" polling: the hours of the day the subscription is polled
   * between, as `{ "start": 9, "end": 18 }`. Null - and the full 0-24 span,
   * which the client sends as null - place no limit.
   */
  intervalPeriod: text("intervalPeriod", { mode: "json" }).$type<{
    start: number;
    end: number;
  }>(),

  prefix: text("prefix"),
  tag: text("tag"),
  webhookOverride: text("webhookOverride"),

  lastVideoId: text("lastVideoId"),
  lastVideoTitle: text("lastVideoTitle"),
  lastVideoDescription: text("lastVideoDescription"),
  lastVideoThumbnailPath: text("lastVideoThumbnailPath"),
  lastCheckedAt: text("lastCheckedAt"),
  nextCheckAt: text("nextCheckAt"),
  lastCaptureAt: text("lastCaptureAt"),

  totalDownloads: integer("totalDownloads")
    .notNull()
    .default(0),

  createdAt: text("createdAt")
    .notNull()
    .default(sql`(datetime('now'))`),

  updatedAt: text("updatedAt")
    .notNull()
    .default(sql`(datetime('now'))`)
});

export const download = sqliteTable("download", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  // The watcher row this came from; `channelId` below is the YouTube channel
  // id, matching the naming used by the channel table.
  watcherId: integer("watcherId").references(() => channel.id, { onDelete: "set null" }),
  channelId: text("channelId"),
  channelName: text("channelName"),

  videoId: text("videoId"),
  title: text("title"),
  url: text("url").notNull(),

  status: text("status").notNull().default("queued"),

  // Which site the video came from: youtube | tiktok | instagram | unknown.
  // Gates the YouTube-only artwork guesses — see services/platform.ts.
  platform: text("platform").notNull().default("unknown"),

  // "watcher" for anything an RSS scan queued, "manual" for a one-off request
  // from the Download-now form. Manual rows carry their own options below,
  // because there is no channel row to read them from.
  source: text("source").notNull().default("watcher"),

  // Snapshot of the channel's settings at queue time, so editing the channel
  // later does not rewrite the history of what was already downloaded. The
  // two flags below are part of that snapshot for a watcher row, and the
  // request's own choice for a manual one.
  type: text("type"),
  format: text("format"),
  codec: text("codec"),
  quality: text("quality"),

  // What the finished file turned out to be — "1080p" for video, "320kbps"
  // for audio — probed once it lands. `quality` above is only what was asked
  // for, and a watcher row never asks. See services/media-quality.ts.
  mediaQuality: text("mediaQuality"),

  // Manual-download options. Unused by watcher rows, which still read the
  // live channel so editing a channel keeps affecting its queued downloads.
  folder: text("folder"),
  prefix: text("prefix"),
  ytdlpArgs: text("ytdlpArgs"),
  clipStart: text("clipStart"),
  clipEnd: text("clipEnd"),

  removeSponsors: integer("removeSponsors", { mode: "boolean" })
    .notNull()
    .default(false),

  splitChapters: integer("splitChapters", { mode: "boolean" })
    .notNull()
    .default(false),

  // Set when the row came from expanding a playlist or channel URL, so the
  // UI can group the videos that were queued together.
  playlistId: text("playlistId"),
  playlistTitle: text("playlistTitle"),
  playlistIndex: integer("playlistIndex"),

  // Seconds, reported by yt-dlp once it resolves the video. Null for anything
  // with no fixed length, such as a live stream.
  duration: integer("duration"),

  progress: integer("progress").notNull().default(0),
  speed: text("speed"),
  eta: text("eta"),
  totalBytes: integer("totalBytes"),

  filePath: text("filePath"),

  // The row's own poster, as a public /images/... path: a frame grabbed out
  // of the finished file for downloads that arrive with no artwork of their
  // own. Null here means the row has nothing of its own, not that it has no
  // picture — what a client is served is resolved from this column, the
  // shared artwork cache and a placeholder, by services/poster.ts.
  thumbnailPath: text("thumbnailPath"),

  error: text("error"),

  createdAt: text("createdAt")
    .notNull()
    .default(sql`(datetime('now'))`),

  startedAt: text("startedAt"),
  finishedAt: text("finishedAt")
});
