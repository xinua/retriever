import { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import fs from "node:fs";

import { db } from "../../db/index.js";
import { download, settings } from "../../db/schema.js";
import * as DownloadQueue from "../../services/download-queue.js";
import { startManualDownload } from "../../services/manual-download.js";
import * as Poster from "../../services/poster.js";
import {
  contentDisposition,
  contentTypeFor,
  parseRange,
  resolveDownloadFile
} from "../../services/download-file.js";
import { broadcast } from "../ws/websockets.js";
import {
  emptyDownloadInfo,
  isDownloadStatus,
  type DownloadStatus
} from "../../models/download.model.js";

const TYPES = new Set(["video", "audio", "thumbnail"]);
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
 * Comma-separated, so one chip can stand for several statuses — the list's
 * "active" counter is queued and running together, not running alone.
 *
 * Unknown values are dropped instead of rejected, matching how `page` and
 * `limit` are handled below: a listing endpoint quietly answering with
 * everything is friendlier than a 400 in the middle of a paging session.
 * An empty result means no filter, not "match nothing".
 */
function parseStatuses(value: unknown): DownloadStatus[] {
  if (typeof value !== "string") return [];

  const wanted = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(isDownloadStatus);

  return [...new Set(wanted)];
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
function buildFilter(statuses: DownloadStatus[], search: string | null): SQL | undefined {
  const clauses: SQL[] = [];

  if (statuses.length) clauses.push(inArray(download.status, statuses));

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
 * filter and name search was asked for. Shared by the plain listing and the
 * search endpoint so the two can never drift apart in paging or ordering.
 */
async function listDownloads(query: {
  limit?: string;
  page?: string;
  statuses?: string;
  name?: string;
}) {
  const take = Math.min(Math.max(Number(query.limit) || 50, 1), 500);

  // A caller asking for page 0, -3 or "abc" gets the first page rather than
  // an error: the offset below has to stay non-negative whatever arrives.
  const requested = Math.max(Math.trunc(Number(query.page)) || 1, 1);

  const statuses = parseStatuses(query.statuses);
  const search = parseSearch(query.name);
  const where = buildFilter(statuses, search);

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
    items: Poster.decorateAll(items),
    total,
    page: current,
    pages,
    limit: take,
    statuses,
    name: typeof query.name === "string" ? query.name.trim() : ""
  };
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

  if (!TYPES.has(type)) {
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
      removeSponsor: body?.removeSponsor === true,
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
   */
  app.get("/api/downloads", async (req) => listDownloads(req.query as any));

  /**
   * The same listing, narrowed to rows whose prefix+title contains `name`.
   * A separate route rather than another query parameter because searching is
   * its own gesture in the UI — the field clears the status chips when it is
   * used — and the client asks for it by URL rather than by remembering to
   * omit a parameter.
   *
   * `page`, `limit` and `statuses` are still honoured, so the paginator keeps
   * working over a result set and a search can be narrowed to one status.
   */
  app.get("/api/downloads/search", async (req) => listDownloads(req.query as any));

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
   * The newest download a watcher produced — what the widget shows for a
   * channel. Newest rather than a list because the widget has room for one
   * card, and asking for it by watcher saves paging through the whole history
   * to find the row.
   *
   * `statuses` narrows it the same way the listing does, so the widget can
   * ask for the latest finished file rather than whatever was queued last.
   */
  app.get("/api/downloads/by-watcher/:watcherId", async (req, reply) => {
    const { watcherId } = req.params as { watcherId: string };
    const { statuses } = req.query as { statuses?: string };

    const id = Number(watcherId);

    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "watcherId must be a number" });
    }

    const wanted = parseStatuses(statuses);

    const where = wanted.length
      ? and(eq(download.watcherId, id), inArray(download.status, wanted))
      : eq(download.watcherId, id);

    const [row] = await db
      .select()
      .from(download)
      .where(where)
      .orderBy(desc(download.createdAt), desc(download.id))
      .limit(1);

    if (!row) return reply.code(404).send({ error: "Not found" });

    return Poster.decorate(row);
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
