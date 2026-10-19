import { sql } from "drizzle-orm";
import { db } from "./index.js";

export function initSchema() {
  runRenameMigrations();

  db.run(sql`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      webhookUrl TEXT,
      downloadsDir TEXT DEFAULT '',
      cookiesPath TEXT,
      ytdlpArgs TEXT,
      ytdlpConcurrency INTEGER NOT NULL DEFAULT 2,
      timeZone TEXT,
      embedVideoCover INTEGER NOT NULL DEFAULT 0,
      telegramEnabled INTEGER NOT NULL DEFAULT 0,
      telegramBotToken TEXT,
      telegramApiUrl TEXT,
      telegramApiRootUsed TEXT,
      telegramKeepFiles INTEGER NOT NULL DEFAULT 0,
      telegramNoDescription INTEGER NOT NULL DEFAULT 0,
      notifyDownloadFailed INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // The UI config moved to the browser's localStorage.
  db.run(sql`DROP TABLE IF EXISTS ui_config;`);

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

  // Seeded here because INSERT OR IGNORE against the id = 1 CHECK is
  // idempotent: the check job only ever updates this row, so it has to exist
  // before the first tick.
  db.run(sql`INSERT OR IGNORE INTO version_check (id) VALUES (1);`);

  db.run(sql`
      CREATE TABLE IF NOT EXISTS subscription_group (
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
    CREATE TABLE IF NOT EXISTS subscription (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      groupId INTEGER REFERENCES subscription_group(id) ON DELETE SET NULL,
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
      notifyTelegram INTEGER NOT NULL DEFAULT 0,
      splitChapters INTEGER NOT NULL DEFAULT 0,
      removeSponsors INTEGER NOT NULL DEFAULT 0,
      pollType TEXT NOT NULL DEFAULT 'interval',
      pollInterval INTEGER,
      pollOnce INTEGER NOT NULL DEFAULT 0,
      pollTime TEXT,
      intervalPeriod TEXT,
      prefix TEXT,
      folder TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_subscription_enabled_nextCheckAt
    ON subscription (enabled, nextCheckAt);
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS download (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watcherId INTEGER REFERENCES subscription(id) ON DELETE SET NULL,
      channelId TEXT,
      channelName TEXT,
      videoId TEXT,
      title TEXT,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      platform TEXT NOT NULL DEFAULT 'unknown',
      source TEXT NOT NULL DEFAULT 'watcher',
      hidden INTEGER NOT NULL DEFAULT 0,
      type TEXT,
      format TEXT,
      codec TEXT,
      quality TEXT,
      mediaQuality TEXT,
      mediaCodec TEXT,
      mediaFormat TEXT,
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
      phase TEXT,
      filePath TEXT,
      thumbnailPath TEXT,
      error TEXT,
      telegramChatId TEXT,
      telegramMessageId INTEGER,
      telegramDelivery TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      startedAt TEXT,
      finishedAt TEXT
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS telegram_chat (
      chatId TEXT PRIMARY KEY,
      type TEXT,
      name TEXT,
      username TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      avatarId TEXT,
      notify INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS telegram_chat_avatar (
      chatId TEXT PRIMARY KEY,
      fileUniqueId TEXT NOT NULL,
      data BLOB NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_download_status_createdAt
    ON download (status, createdAt);
  `);

  runColumnMigrations();
}

function tableExists(name: string): boolean {
  return !!db.get(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`);
}

function columnExists(table: string, name: string): boolean {
  const columns = db.all(sql`PRAGMA table_info(${sql.raw(table)})`);
  return columns.some((c: any) => c.name === name);
}

/**
 * Renames tables and columns in an existing database. Runs before the CREATE
 * TABLEs, which would otherwise make an empty table under the new name next to
 * the old one. RENAME also rewrites the foreign keys that point at a table.
 */
function runRenameMigrations() {
  if (tableExists("channel_group") && !tableExists("subscription_group")) {
    db.run(sql`ALTER TABLE channel_group RENAME TO subscription_group`);
  }

  if (tableExists("channel") && !tableExists("subscription")) {
    db.run(sql`ALTER TABLE channel RENAME TO subscription`);
    db.run(sql`DROP INDEX IF EXISTS idx_channel_enabled_nextCheckAt`);
  }

  if (tableExists("subscription") && columnExists("subscription", "tag")) {
    db.run(sql`ALTER TABLE subscription RENAME COLUMN tag TO folder`);
  }
}

/**
 * Adds a column only when it is missing, so existing databases pick up
 * new fields without a migration tool.
 */
function ensureColumn(table: string, name: string, ddl: string) {
  if (!columnExists(table, name)) {
    db.run(sql`ALTER TABLE ${sql.raw(table)} ADD COLUMN ${sql.raw(name)} ${sql.raw(ddl)}`);
  }
}

/**
 * Columns added after a release go here as well as into the CREATE TABLE
 * above: CREATE TABLE IF NOT EXISTS skips a table that already exists, so this
 * is the only way an existing database picks them up.
 */
function runColumnMigrations() {
  ensureColumn("settings", "telegramApiRootUsed", "TEXT");
}

/**
 * Downloads that were running when the process died can never resume,
 * so put them back in the queue on boot.
 */
export function requeueStaleDownloads() {
  db.run(sql`
    UPDATE download
    SET status = 'queued', progress = 0, speed = NULL, eta = NULL, phase = NULL, startedAt = NULL
    WHERE status = 'running'
  `);
}