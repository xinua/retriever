import { sql } from "drizzle-orm";
import { db } from "./index.js";

export function initSchema() {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      webhookUrl TEXT,
      downloadsDir TEXT DEFAULT '/downloads',
      cookiesPath TEXT,
      ytdlpArgs TEXT,
      ytdlpConcurrency INTEGER NOT NULL DEFAULT 2,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS ui_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sectionsBg TEXT NOT NULL DEFAULT 'dotted',
      themeColor TEXT NOT NULL DEFAULT 'red',
      enableAnimations INTEGER NOT NULL DEFAULT 1,
      autoPaste INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seeded here rather than in server.ts, next to the settings seed, because
  // INSERT OR IGNORE against the id = 1 CHECK is idempotent on its own - no
  // select-then-insert, so a GET can never arrive before the row exists.
  db.run(sql`INSERT OR IGNORE INTO ui_config (id) VALUES (1);`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS version_check (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      latestVersion TEXT,
      releaseDate TEXT,
      payload TEXT,
      checkedAt TEXT,
      lastAttemptAt TEXT,
      lastError TEXT,
      nextCheckAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Same idempotent seed as ui_config: the check job only ever updates this
  // row, so it has to exist before the first tick.
  db.run(sql`INSERT OR IGNORE INTO version_check (id) VALUES (1);`);

  db.run(sql`
      CREATE TABLE IF NOT EXISTS channel_group (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        color TEXT DEFAULT '#ffffff',
        icon TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS channel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      groupId INTEGER REFERENCES channel_group(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      channelId  TEXT,
      channelDescription  TEXT,
      channelAvatarPath  TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT '#ffffff',
      rssUrl TEXT NOT NULL,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      codec TEXT,
      ytdlpArgs TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      startFromLast INTEGER NOT NULL DEFAULT 1,
      downloadShorts INTEGER NOT NULL DEFAULT 0,
      notifyHA INTEGER NOT NULL DEFAULT 0,
      splitChapters INTEGER NOT NULL DEFAULT 0,
      removeSponsors INTEGER NOT NULL DEFAULT 0,
      pollType TEXT NOT NULL DEFAULT 'interval',
      pollInterval INTEGER,
      pollOnce INTEGER NOT NULL DEFAULT 0,
      pollTime TEXT,
      intervalPeriod TEXT,
      prefix TEXT,
      tag TEXT,
      webhookOverride TEXT,
      lastVideoTitle  TEXT,
      lastVideoDescription  TEXT,
      lastVideoThumbnailPath  TEXT,
      lastVideoId TEXT,
      lastCheckedAt TEXT,
      nextCheckAt TEXT,
      lastCaptureAt  TEXT,
      totalDownloads INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(sql `
    CREATE INDEX IF NOT EXISTS idx_channel_enabled_nextCheckAt
    ON channel (enabled, nextCheckAt);
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS download (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watcherId INTEGER REFERENCES channel(id) ON DELETE SET NULL,
      channelId TEXT,
      channelName TEXT,
      videoId TEXT,
      title TEXT,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      platform TEXT NOT NULL DEFAULT 'unknown',
      source TEXT NOT NULL DEFAULT 'watcher',
      type TEXT,
      format TEXT,
      codec TEXT,
      quality TEXT,
      mediaQuality TEXT,
      mediaCodec TEXT,
      folder TEXT,
      prefix TEXT,
      ytdlpArgs TEXT,
      clipStart TEXT,
      clipEnd TEXT,
      removeSponsors INTEGER NOT NULL DEFAULT 0,
      splitChapters INTEGER NOT NULL DEFAULT 0,
      playlistId TEXT,
      playlistTitle TEXT,
      playlistIndex INTEGER,
      duration INTEGER,
      progress INTEGER NOT NULL DEFAULT 0,
      speed TEXT,
      eta TEXT,
      totalBytes INTEGER,
      filePath TEXT,
      thumbnailPath TEXT,
      error TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      startedAt TEXT,
      finishedAt TEXT
    );
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_download_status_createdAt
    ON download (status, createdAt);
  `);

  runColumnMigrations();
}

/**
 * Adds a column only when it is missing, so existing databases pick up
 * new fields without a migration tool.
 */
function ensureColumn(table: string, name: string, ddl: string) {
  const columns = db.all(sql`PRAGMA table_info(${sql.raw(table)})`);
  const exists = columns.some((c: any) => c.name === name);

  if (!exists) {
    db.run(sql`ALTER TABLE ${sql.raw(table)} ADD COLUMN ${sql.raw(name)} ${sql.raw(ddl)}`);
  }
}

function dropColumn(table: string, name: string) {
  const columns = db.all(sql`PRAGMA table_info(${sql.raw(table)})`);
  const exists = columns.some((c: any) => c.name === name);

  if (exists) {
    db.run(sql`ALTER TABLE ${sql.raw(table)} DROP COLUMN ${sql.raw(name)}`);
  }
}

function runColumnMigrations() {
  ensureColumn("channel", "groupId", "INTEGER");

  // Redundant against the CREATE TABLE above for a fresh database, and
  // deliberately so - same belt-and-braces as the settings columns below, so a
  // database created before a field existed picks it up on the next boot.
  ensureColumn("ui_config", "sectionsBg", "TEXT NOT NULL DEFAULT 'dotted'");
  ensureColumn("ui_config", "themeColor", "TEXT NOT NULL DEFAULT 'red'");
  ensureColumn("ui_config", "enableAnimations", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("ui_config", "autoPaste", "INTEGER NOT NULL DEFAULT 0");

  ensureColumn("settings", "downloadsDir", "TEXT DEFAULT '/downloads'");
  ensureColumn("settings", "cookiesPath", "TEXT");
  ensureColumn("settings", "ytdlpArgs", "TEXT");
  ensureColumn("settings", "ytdlpConcurrency", "INTEGER NOT NULL DEFAULT 2");

  ensureColumn("channel", "ytdlpArgs", "TEXT");

  migrateChannelPollColumns();

  migrateDownloadChannelColumns();

  dropMeTubeColumns();
}

/**
 * Per-video options that used to be manual-download-only, and the poll window
 * that goes with an interval. Both are read straight off the channel row by
 * the watcher, so nothing has to be backfilled: the defaults describe how
 * every existing subscription already behaves.
 */
function migrateChannelPollColumns() {
  ensureColumn("channel", "splitChapters", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("channel", "removeSponsors", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("channel", "intervalPeriod", "TEXT");

  // Off is how every existing subscription already polls, so the default
  // describes them and nothing needs backfilling.
  ensureColumn("channel", "pollOnce", "INTEGER NOT NULL DEFAULT 0");

  migrateLegacyPollTime();
}

/**
 * `pollTime` held one ISO instant; it now holds a JSON list of wall-clock
 * hours, which is what the form offers. The column is read as JSON, so a row
 * left in the old shape throws on the next select rather than merely reading
 * oddly - convert in place.
 *
 * The hour is taken off the stored instant in local time, the clock the new
 * field is read against, and truncated: the form only offers whole hours, so
 * an old 09:45 becomes 09:00 and the subscription keeps polling in the same
 * part of the day.
 */
function migrateLegacyPollTime() {
  const rows = db.all(sql`
    SELECT id, pollTime FROM channel
    WHERE pollTime IS NOT NULL AND pollTime NOT LIKE '[%'
  `) as { id: number; pollTime: string }[];

  for (const row of rows) {
    const parsed = new Date(row.pollTime);

    const pollTime = Number.isNaN(parsed.getTime())
      ? "[]"
      : JSON.stringify([`${String(parsed.getHours()).padStart(2, "0")}:00`]);

    db.run(sql`UPDATE channel SET pollTime = ${pollTime} WHERE id = ${row.id}`);
  }
}

/**
 * MeTube was removed: yt-dlp is the only downloader, so there is no URL to
 * point at and nothing left to choose between - globally or per channel.
 * `settings.metubeUrl` is NOT NULL with no default, so it has to go rather
 * than linger, otherwise seeding a fresh settings row on an old database
 * fails.
 */
function dropMeTubeColumns() {
  dropColumn("settings", "metubeUrl");
  dropColumn("settings", "downloader");
  dropColumn("channel", "downloader");
  dropColumn("download", "downloader");
}

/**
 * `download.channelId` originally held the watcher row id, which clashed with
 * `channel.channelId` (the YouTube id). Rename it to watcherId and give
 * channelId its expected meaning.
 */
function migrateDownloadChannelColumns() {
  const columns = db.all(sql`PRAGMA table_info(download)`) as any[];

  const channelIdCol = columns.find((c) => c.name === "channelId");
  const hasWatcherId = columns.some((c) => c.name === "watcherId");

  if (!hasWatcherId && channelIdCol?.type === "INTEGER") {
    db.run(sql`ALTER TABLE download RENAME COLUMN channelId TO watcherId`);
  }

  ensureColumn(
    "download",
    "watcherId",
    "INTEGER REFERENCES channel(id) ON DELETE SET NULL"
  );
  ensureColumn("download", "channelId", "TEXT");

  ensureColumn("download", "type", "TEXT");
  ensureColumn("download", "format", "TEXT");
  ensureColumn("download", "codec", "TEXT");
  ensureColumn("download", "duration", "INTEGER");

  // Manual downloads: the row carries its own options, since there is no
  // channel to read them from.
  ensureColumn("download", "source", "TEXT NOT NULL DEFAULT 'watcher'");
  ensureColumn("download", "quality", "TEXT");
  ensureColumn("download", "mediaQuality", "TEXT");
  ensureColumn("download", "mediaCodec", "TEXT");
  ensureColumn("download", "folder", "TEXT");
  ensureColumn("download", "prefix", "TEXT");
  ensureColumn("download", "ytdlpArgs", "TEXT");
  ensureColumn("download", "clipStart", "TEXT");
  ensureColumn("download", "clipEnd", "TEXT");
  renameRemoveSponsorColumn();
  ensureColumn("download", "removeSponsors", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("download", "splitChapters", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("download", "playlistId", "TEXT");
  ensureColumn("download", "playlistTitle", "TEXT");
  ensureColumn("download", "playlistIndex", "INTEGER");
  ensureColumn("download", "platform", "TEXT NOT NULL DEFAULT 'unknown'");

  // Per-row poster; rows that predate it fall back to the shared artwork
  // cache in the UI, so there is nothing to backfill.
  ensureColumn("download", "thumbnailPath", "TEXT");

  backfillDownloadPlatform();

  // Backfill the real channel id for rows that predate the split.
  db.run(sql`
    UPDATE download
    SET channelId = (
      SELECT channelId FROM channel WHERE channel.id = download.watcherId
    )
    WHERE channelId IS NULL AND watcherId IS NOT NULL
  `);

  normalizeDownloadTimestamps();
}

/**
 * `download.removeSponsor` became `removeSponsors`, matching the channel
 * column and the form control that writes it - one name for the flag across
 * the whole app rather than one per caller.
 */
function renameRemoveSponsorColumn() {
  const columns = db.all(sql`PRAGMA table_info(download)`) as any[];

  const hasOld = columns.some((c) => c.name === "removeSponsor");
  const hasNew = columns.some((c) => c.name === "removeSponsors");

  if (hasOld && !hasNew) {
    db.run(sql`ALTER TABLE download RENAME COLUMN removeSponsor TO removeSponsors`);
  }
}

/**
 * Every row that predates the column is "unknown", which would wrongly gate
 * the YouTube artwork for the entire existing history. The URL is the one
 * piece of evidence those rows always carry, so classify from that. Kept in
 * SQL rather than services/platform.ts because it runs once at boot over the
 * whole table; the two lists must be kept in step if a platform is added.
 */
function backfillDownloadPlatform() {
  db.run(sql`
    UPDATE download
    SET platform = CASE
      WHEN url LIKE '%youtube.com/%' OR url LIKE '%youtu.be/%' THEN 'youtube'
      WHEN url LIKE '%tiktok.com/%' THEN 'tiktok'
      WHEN url LIKE '%instagram.com/%' THEN 'instagram'
      ELSE 'unknown'
    END
    WHERE platform IS NULL OR platform = 'unknown'
  `);
}

/**
 * Rows written by the column default carry SQLite's "YYYY-MM-DD HH:MM:SS",
 * while every timestamp set from code is ISO 8601. Both the queue order and
 * the list order are text comparisons over this column, so a mix of the two
 * formats sorts newer rows below older ones. datetime('now') is UTC, so the
 * conversion names the same instant.
 */
function normalizeDownloadTimestamps() {
  db.run(sql`
    UPDATE download
    SET createdAt = replace(createdAt, ' ', 'T') || '.000Z'
    WHERE createdAt NOT LIKE '%T%'
  `);
}

/**
 * Downloads that were running when the process died can never resume,
 * so put them back in the queue on boot.
 */
export function requeueStaleDownloads() {
  db.run(sql`
    UPDATE download
    SET status = 'queued', progress = 0, speed = NULL, eta = NULL, startedAt = NULL
    WHERE status = 'running'
  `);
}