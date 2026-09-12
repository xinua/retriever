import { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import fs from "node:fs";

import { db } from "../../db/index.js";
import { channel, download, settings } from "../../db/schema.js";
import * as DownloadQueue from "../../services/download-queue.js";
import { startManualDownload } from "../../services/manual-download.js";
import * as Poster from "../../services/poster.js";
import * as MediaQuality from "../../services/media-quality.js";
import {
  contentDisposition,
  contentTypeFor,
  parseRange,
  resolveDownloadFile,
  resolveNewFilePath,
  withFileExists
} from "../../services/download-file.js";
import { broadcast } from "../ws/websockets.js";
import {
  emptyDownloadInfo,
  isDownloadStatus,
  isDownloadType,
  type DownloadStatus,
  type DownloadType
} from "../../models/download.model.js";
import type { Download, Settings } from "../../db/types.js";

const VIDEO_FORMATS = new Set(["auto", "mp4", "ios"]);
const AUDIO_FORMATS = new Set(["m4a", "mp3", "opus", "wav", "flac"]);
const CODECS = new Set(["auto", "h264", "h265", "av1", "vp9"]);

/**
 * Video quality is a resolution ceiling, audio quality a target bitrate. The
 * two vocabularies overlap only on "best", so which one a request is checked
 * against depends on its type.
 */
const VIDEO_QUALITIES = new Set([
  "best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "worst"
]);

const AUDIO_QUALITIES = new Set(["best", "320kbps", "192kbps", "128kbps"]);

// hh:mm:ss, mm:ss or plain seconds — what --download-sections accepts.
const TIMESTAMP = /^(\d{1,2}:){0,2}\d{1,2}(\.\d+)?$/;

/**
 * Comma-separated, so one menu can stand for several values — the list's
 * "active" counter is queued and running together, not running alone.
 *
 * Unknown values are dropped instead of rejected, matching how `page` and
 * `limit` are handled below: a listing endpoint quietly answering with
 * everything is friendlier than a 400 in the middle of a paging session.
 * An empty result means no filter, not "match nothing" — which is also what
 * an empty parameter means, so a client that always sends `statuses=` rather
 * than omitting it gets the unfiltered list instead of nothing.
 */
function parseList<T extends string>(
  value: unknown,
  isValid: (entry: unknown) => entry is T
): T[] {
  if (typeof value !== "string") return [];

  const wanted = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(isValid);

  return [...new Set(wanted)];
}

function parseStatuses(value: unknown): DownloadStatus[] {
  return parseList(value, isDownloadStatus);
}

function parseTypes(value: unknown): DownloadType[] {
  return parseList(value, isDownloadType);
}

/**
 * Longer than any title someone would actually type. A cap keeps a
 * pathological pattern — a megabyte of `%` — from reaching SQLite at all.
 */
const MAX_SEARCH_LENGTH = 200;

/**
 * Turns a raw `name` query parameter into a LIKE pattern, or null for "no
 * search" — an empty or absent term matches everything, the same way an empty
 * status list does.
 *
 * `%` and `_` are LIKE's own wildcards, so a search for "100%" or "foo_bar"
 * would otherwise quietly mean something else; they are escaped here and the
 * query below declares the escape character. The term is lowered with the
 * same `toLowerCase()` that `lower_u()` applies to the column, so both sides
 * of the comparison are folded identically — see db/index.ts.
 */
function parseSearch(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const text = value.trim().slice(0, MAX_SEARCH_LENGTH);

  if (!text) return null;

  const escaped = text.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`);

  return `%${escaped}%`;
}

/**
 * What a search term is matched against: the name the list actually shows,
 * which is the file-name prefix followed by the title. Matching the title
 * alone missed the prefix half — someone typing "Channel - " to find one
 * channel's downloads got nothing back, even though every row on screen
 * started with those words.
 *
 * COALESCE on both halves because either can be null, and concatenating a
 * null in SQLite yields null, which would drop the row from every search.
 * Lowered with `lower_u` so the comparison folds Unicode the same way the
 * pattern above was folded — see db/index.ts.
 */
const SEARCHABLE_NAME = sql`lower_u(COALESCE(${download.prefix}, '') || COALESCE(${download.title}, ''))`;

/**
 * The filters a listing accepts, as one expression. Both the page query and
 * the count that sizes the paginator have to see exactly the same rows, or
 * the UI would offer pages the filter cannot fill.
 */
function buildFilter(
  statuses: DownloadStatus[],
  types: DownloadType[],
  search: string | null
): SQL | undefined {
  const clauses: SQL[] = [];

  if (statuses.length) clauses.push(inArray(download.status, statuses));

  // Each group narrows the last: picking "audio" and "done" means audio rows
  // that are done, not every audio row plus every done row. Within a group
  // the values are alternatives, which is what the menu's checkmarks show.
  //
  // `type` is nullable, and `IN` never matches NULL — so a row queued before
  // the type snapshot existed drops out of a type-filtered list, which is the
  // honest answer for a row whose type nobody recorded.
  if (types.length) clauses.push(inArray(download.type, types));

  // Substring match rather than an anchored one: people remember a word from
  // the middle of a video title far more often than its first word. No index
  // can serve a leading-wildcard LIKE, but this scans one narrow expression
  // over a table that is thousands of rows, not millions.
  if (search) {
    clauses.push(sql`${SEARCHABLE_NAME} LIKE ${search} ESCAPE '\\'`);
  }

  return clauses.length ? and(...clauses) : undefined;
}

/**
 * One page of history, newest first, for whatever combination of status
 * filter, type filter and name search was asked for. Each narrowing is
 * optional and they compose, so a search can be restricted to one status or
 * one kind of file without a second trip.
 */
async function listDownloads(settings: Settings, query: {
  limit?: string;
  page?: string;
  statuses?: string;
  types?: string;
  name?: string;
}) {
  const take = Math.min(Math.max(Number(query.limit) || 50, 1), 500);

  // A caller asking for page 0, -3 or "abc" gets the first page rather than
  // an error: the offset below has to stay non-negative whatever arrives.
  const requested = Math.max(Math.trunc(Number(query.page)) || 1, 1);

  const statuses = parseStatuses(query.statuses);
  const types = parseTypes(query.types);
  const search = parseSearch(query.name);
  const where = buildFilter(statuses, types, search);

  const [counted] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(download)
    .where(where);

  const total = Number(counted?.total) || 0;

  // At least one page even when the table is empty, so `page` is always a
  // valid value the UI can echo back.
  const pages = Math.max(Math.ceil(total / take), 1);

  // Past the end returns the last page instead of an empty list. Rows are
  // deleted while someone is paging, so a page number that was valid when
  // the UI rendered it can be stale by the time it is used.
  const current = Math.min(requested, pages);

  const items = await db
    .select()
    .from(download)
    .where(where)
    .orderBy(desc(download.createdAt), desc(download.id))
    .limit(take)
    .offset((current - 1) * take);

  // Echoed back so a client can tell which filter produced this page — the
  // list arrives asynchronously, and a stale response must be recognisable.
  return {
    items: await withFileExists(Poster.decorateAll(items), settings),
    total,
    page: current,
    pages,
    limit: take,
    statuses,
    types,
    name: typeof query.name === "string" ? query.name.trim() : ""
  };
}

/**
 * The download behind a watcher's last video, optionally narrowed to some
 * statuses and types.
 *
 * Pinned to `channel.lastVideoId` rather than simply the newest row, because
 * that is the video the card names and pictures: a scan writes the channel's
 * last video as soon as it queues it, so a download that then fails leaves
 * the newest *finished* row belonging to an older video. Answering with that
 * row put the previous video behind the current one's poster and title. With
 * nothing to play the card now says so instead of playing the wrong file.
 *
 * Falls back to the newest row when the watcher has no last video recorded —
 * a channel row deleted out from under its downloads, or one that never
 * completed a scan — where "the newest one" is the best answer available.
 *
 * The narrowing reuses `buildFilter`, so a filter means the same thing here
 * as it does in the listing rather than being spelled out a second way.
 */
async function newestForWatcher(
  watcherId: number,
  statuses: DownloadStatus[],
  types: DownloadType[]
): Promise<Download | undefined> {
  const [watcher] = await db
    .select({ lastVideoId: channel.lastVideoId })
    .from(channel)
    .where(eq(channel.id, watcherId));

  const clauses: SQL[] = [eq(download.watcherId, watcherId)];

  if (watcher?.lastVideoId) {
    clauses.push(eq(download.videoId, watcher.lastVideoId));
  }

  const narrowed = buildFilter(statuses, types, null);

  if (narrowed) clauses.push(narrowed);

  const [row] = await db
    .select()
    .from(download)
    .where(and(...clauses))
    .orderBy(desc(download.createdAt), desc(download.id))
    .limit(1);

  return row;
}

async function loadSettings(): Promise<Settings | undefined> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.id, 1));

  return row;
}

function normalize(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";

  return text.length ? text : null;
}

/**
 * The form is the only caller today, but a request arriving over HTTP is
 * still untrusted: anything that ends up on a command line or a filesystem
 * path is checked against the values the UI can actually produce.
 */
function parseManualBody(body: any):
  | { ok: true; url: string; options: DownloadQueue.ManualOptions }
  | { ok: false; error: string } {
  const url = normalize(body?.url);

  if (!url) return { ok: false, error: "url is required" };

  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "url must start with http:// or https://" };
  }

  const type = normalize(body?.type) ?? "video";

  // The same three words the `types` filter accepts, from one list — a type
  // the form can produce and the listing cannot filter by would be a row
  // nobody could find again.
  if (!isDownloadType(type)) {
    return { ok: false, error: `Unsupported type "${type}"` };
  }

  const format = normalize(body?.format) ?? (type === "audio" ? "m4a" : "mp4");
  const allowedFormats = type === "audio" ? AUDIO_FORMATS : VIDEO_FORMATS;

  // A thumbnail is always a jpg, so its format is whatever the form last had.
  if (type !== "thumbnail" && !allowedFormats.has(format)) {
    return { ok: false, error: `Unsupported ${type} format "${format}"` };
  }

  const codec = normalize(body?.codec) ?? "auto";

  if (!CODECS.has(codec)) {
    return { ok: false, error: `Unsupported codec "${codec}"` };
  }

  // A thumbnail has no stream to choose between, so nothing is recorded for
  // it — the same treatment its format gets below. The form keeps whatever
  // quality was last picked while the type is thumbnail, and that leftover
  // value must not be validated against a list it was never meant for.
  const quality = type === "thumbnail" ? null : (normalize(body?.quality) ?? "best");
  const allowedQualities = type === "audio" ? AUDIO_QUALITIES : VIDEO_QUALITIES;

  if (quality && !allowedQualities.has(quality)) {
    return { ok: false, error: `Unsupported ${type} quality "${quality}"` };
  }

  const clipStart = normalize(body?.clipStart);
  const clipEnd = normalize(body?.clipEnd);

  for (const [label, value] of [["Clip start", clipStart], ["Clip end", clipEnd]] as const) {
    if (value && !TIMESTAMP.test(value)) {
      return { ok: false, error: `${label} must look like 00:01:15` };
    }
  }

  return {
    ok: true,
    url,
    options: {
      type,
      format: type === "thumbnail" ? "jpg" : format,
      codec,
      quality,
      folder: normalize(body?.folder),
      prefix: typeof body?.prefix === "string" && body.prefix.length ? body.prefix : null,
      ytdlpArgs: normalize(body?.ytdlpArgs),
      clipStart,
      clipEnd,
      // `removeSponsor` is the spelling the manual-download form used before
      // the flag settled on one name; still accepted so a tab left open
      // across an upgrade does not quietly stop cutting sponsor segments.
      removeSponsors:
        body?.removeSponsors === true || body?.removeSponsor === true,
      splitChapters: body?.splitChapters === true
    }
  };
}

export async function downloadsRoutes(app: FastifyInstance) {
  /**
   * One page of history, newest first. The list is server-paginated because
   * it grows without bound — a year of watched channels is tens of thousands
   * of rows, and shipping all of them to render ten is what the `page`
   * argument exists to avoid.
   *
   * Every way of narrowing the list is a query parameter here: `statuses` and
   * `types` for the filter menu, `name` for the search field. Searching used
   * to be its own route, but it was the same handler reached by a different
   * URL — which made a search that is also filtered awkward to ask for, and
   * left two places for paging or ordering to drift apart.
   */
  app.get("/api/downloads", async (req, reply) => {
    const appSettings = await loadSettings();

    if (!appSettings) {
      return reply.code(500).send({ error: "Settings unavailable" });
    }

    return listDownloads(appSettings, req.query as any);
  });

  /**
   * Queue counts for the dashboard. One grouped query rather than fetching
   * rows and counting them in JS, so it stays cheap however long the history
   * grows — and it reads the whole table, not just the page the list shows.
   */
  app.get("/api/downloads/info", async (req) => {
    const { name } = req.query as { name?: string };

    const search = parseSearch(name);

    // The counts size the paginator and label the filter chips, so they have
    // to be counts of the same rows the list is showing. A search that is not
    // reflected here would offer pages of results that do not exist.
    const scope = search
      ? sql`WHERE ${SEARCHABLE_NAME} LIKE ${search} ESCAPE '\\'`
      : sql.empty();

    const rows = db.all<{ status: string; count: number }>(sql`
      SELECT status, COUNT(*) AS count
      FROM download
      ${scope}
      GROUP BY status
    `);

    // Keyed by the status strings themselves rather than prose names, so the
    // list can read a count with the same value it filters by:
    // info[status] for any status, info.total for no filter.
    const info = emptyDownloadInfo();

    for (const row of rows) {
      const count = Number(row.count) || 0;

      // Counted towards the total even if some future status is not broken
      // out above, so the numbers never quietly stop adding up.
      info.total += count;

      if (isDownloadStatus(row.status)) info[row.status] += count;
    }

    return info;
  });

  /**
   * The download behind a watcher's last video — what the widget shows for a
   * channel. One row rather than a list because the widget has room for one
   * card, and asking for it by watcher saves paging through the whole history
   * to find it.
   *
   * `statuses` and `types` narrow it the same way they narrow the listing, so
   * the widget can ask for a finished file rather than whatever state the row
   * is in. `null` is the answer when the last video has no row that matches —
   * it failed, or is still queued — and the card has nothing to play. That is
   * an ordinary answer for a card to get, not a failure, so it is a 200 rather
   * than a 404 that every page load would print in the browser console.
   *
   * The row carries `fileExists`, which is what the card checks before
   * offering to play.
   */
  app.get("/api/downloads/by-watcher/:watcherId", async (req, reply) => {
    const { watcherId } = req.params as { watcherId: string };
    const { statuses, types } = req.query as { statuses?: string; types?: string };

    const id = Number(watcherId);

    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "watcherId must be a number" });
    }

    const row = await newestForWatcher(id, parseStatuses(statuses), parseTypes(types));

    if (!row) return reply.send(null);

    const appSettings = await loadSettings();

    if (!appSettings) {
      return reply.code(500).send({ error: "Settings unavailable" });
    }

    const [withFile] = await withFileExists([Poster.decorate(row)], appSettings);

    return withFile;
  });

  /**
   * Ad-hoc download, outside of any watched channel. A video URL queues one
   * job; a playlist or channel URL is expanded first and queues one per video.
   */
  app.post("/api/downloads", async (req, reply) => {
    const parsed = parseManualBody(req.body);

    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }

    const [appSettings] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    if (!appSettings) {
      return reply.code(500).send({ error: "Settings unavailable" });
    }

    try {
      const result = await startManualDownload(
        { url: parsed.url, options: parsed.options },
        appSettings
      );

      return { ok: true, ...result };
    } catch (e: any) {
      req.log.error({ err: e }, "Manual download failed");

      return reply.code(422).send({
        error: e?.message ?? "Could not queue that URL"
      });
    }
  });

  /**
   * Streams a finished file to the browser as an attachment.
   *
   * A GET the browser navigates to, rather than something fetched into
   * memory: these files run to hundreds of megabytes, so the transfer belongs
   * to the browser's own download manager — which also gets it resumable and
   * keeps it off the JS heap.
   */
  app.get("/api/downloads/:id/file", async (req, reply) => {
    const { id } = req.params as { id: string };

    // The in-page player asks for inline; the Save button takes the default
    // attachment so the browser's download manager handles it.
    const { inline } = req.query as { inline?: string };
    const isInline = inline === "1" || inline === "true";

    const [row] = await db
      .select()
      .from(download)
      .where(eq(download.id, Number(id)));

    if (!row) return reply.code(404).send({ error: "Not found" });

    const [appSettings] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    if (!appSettings) {
      return reply.code(500).send({ error: "Settings unavailable" });
    }

    const file = await resolveDownloadFile(row, appSettings);

    if (!file.ok) {
      return reply.code(file.status).send({ error: file.error });
    }

    const range = parseRange(req.headers.range, file.size);

    if (range === "unsatisfiable") {
      return reply
        .code(416)
        .header("content-range", `bytes */${file.size}`)
        .send({ error: "Requested range not satisfiable" });
    }

    reply
      .header("content-type", contentTypeFor(file.filename))
      .header("content-disposition", contentDisposition(file.filename, isInline))
      // Lets a browser or download manager resume a large transfer.
      .header("accept-ranges", "bytes")
      .header("cache-control", "private, max-age=0, must-revalidate");

    if (range) {
      return reply
        .code(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${file.size}`)
        .header("content-length", range.end - range.start + 1)
        .send(fs.createReadStream(file.path, { start: range.start, end: range.end }));
    }

    return reply
      .header("content-length", file.size)
      .send(fs.createReadStream(file.path));
  });

  /**
   * Re-points a row at a different file on disk.
   *
   * Nothing is moved or renamed: this corrects the record when the file was
   * reorganised outside the app, so the row's Save, play and poster actions
   * find it again. The target therefore has to exist inside the downloads
   * folder — see `resolveNewFilePath`, which applies the same checks the file
   * endpoint applies before serving anything.
   *
   * Refused while the job is queued or running, because the worker writes
   * `filePath` itself when it finishes and would overwrite the new value a
   * moment later.
   */
  app.patch("/api/downloads/:id/path", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rowId = Number(id);

    if (!Number.isInteger(rowId)) {
      return reply.code(400).send({ error: "id must be a number" });
    }

    const { path: wanted } = (req.body ?? {}) as { path?: unknown };

    if (typeof wanted !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const [row] = await db
      .select()
      .from(download)
      .where(eq(download.id, rowId));

    if (!row) return reply.code(404).send({ error: "Not found" });

    if (row.status === "running" || row.status === "queued") {
      return reply.code(409).send({ error: "Download is still active" });
    }

    const [appSettings] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    if (!appSettings) {
      return reply.code(500).send({ error: "Settings unavailable" });
    }

    const file = await resolveNewFilePath(wanted, appSettings);

    if (!file.ok) {
      return reply.code(file.status).send({ error: file.error });
    }

    // The resolved realpath rather than what was typed, so the column keeps
    // holding an absolute path that the file endpoint can use directly.
    const [updated] = await db
      .update(download)
      .set({
        filePath: file.path,
        mediaQuality: await MediaQuality.probe(file.path, row.type)
      })
      .where(eq(download.id, rowId))
      .returning();

    // Just resolved above, so the file is known to be there.
    const decorated = { ...Poster.decorate(updated), fileExists: true };

    broadcast("download-updated", decorated);

    return decorated;
  });

  app.post("/api/downloads/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };

    const row = await DownloadQueue.retry(Number(id));

    if (!row) {
      return reply.code(409).send({ error: "Download cannot be retried" });
    }

    return row;
  });

  /**
   * Emergency stop: cancels everything queued or running in one call, so a
   * 500-video playlist does not need 500 requests to stop.
   */
  app.post("/api/downloads/cancel-all", async () => {
    const rows = await DownloadQueue.cancelAll();

    return { ok: true, canceled: rows.length };
  });

  app.post("/api/downloads/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };

    const ok = await DownloadQueue.cancel(Number(id));

    if (!ok) {
      return reply.code(409).send({ error: "Download is not cancelable" });
    }

    return { ok: true };
  });

  app.delete("/api/downloads/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const [row] = await db
      .select()
      .from(download)
      .where(eq(download.id, Number(id)));

    if (!row) return reply.code(404).send({ error: "Not found" });

    if (row.status === "running" || row.status === "queued") {
      return reply.code(409).send({ error: "Download is still active" });
    }

    await db.delete(download).where(eq(download.id, Number(id)));

    // Captured posters live in the images directory rather than beside the
    // media, so nothing else would ever collect them.
    Poster.remove(Number(id));

    broadcast("download-removed", { id: Number(id) });

    return { ok: true };
  });

  app.post("/api/downloads/clear-finished", async () => {
    const doomed = await db
      .select({ id: download.id })
      .from(download)
      .where(inArray(download.status, ["done", "failed", "canceled"]));

    await db.run(sql`
      DELETE FROM download
      WHERE status IN ('done', 'failed', 'canceled')
    `);

    for (const row of doomed) Poster.remove(row.id);

    broadcast("downloads-cleared", { ok: true });

    return { ok: true };
  });
}
