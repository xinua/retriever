import { spawn, type ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { channel, download, settings } from "../db/schema.js";
import { broadcast } from "../routes/ws/websockets.js";
import * as ytdlp from "./ytdlp.js";

import type { Channel, Download, NewDownload, Settings } from "../db/types.js";
import type { ResolvedEntry } from "./resolve.js";
import { platformFromUrl } from "./platform.js";
import * as InfoCache from "./info-cache.js";
import * as Ffmpeg from "./ffmpeg.js";
import * as Poster from "./poster.js";
import * as CoverArt from "./cover-art.js";
import { isFfmpegFailure, isPermanent } from "./retry-policy.js";

const PROGRESS_BROADCAST_MS = 1000;

/**
 * yt-dlp's reported `speed` is measured inside whichever transfer happens to
 * be in flight, so a fragmented download reports the burst rate of a single
 * fragment and ignores the gaps between them — an HLS job crawling along at
 * 40 KB/s cheerfully displays "1.3 MB/s", with an ETA to match. Deriving the
 * rate from how many bytes actually landed between two samples counts those
 * gaps, so speed and ETA agree with what the progress bar is doing.
 */
const RATE_WINDOW_MS = 30_000;

/** Below this the span is too short to divide by; jitter dominates. */
const RATE_MIN_SAMPLE_MS = 500;

type RateSample = { at: number; bytes: number };

const running = new Map<number, ChildProcess>();

const MAX_AUTO_RETRIES = 2;

/** Backoff between automatic attempts; the challenge tends to pass on a retry. */
const AUTO_RETRY_DELAY_MS = 4000;

/**
 * Automatic attempts spent per download id. In memory on purpose: a restart
 * requeues the row anyway, and a fresh process deserves a fresh budget.
 */
const autoRetries = new Map<number, number>();

/**
 * Downloads the user asked to retry by hand. A watcher job records what it
 * fetched in its own archive, so a second attempt at a video that once
 * succeeded is skipped outright and the retry means nothing — the same reason
 * manual downloads ignore the archive. In memory alongside the retry budget:
 * the flag only has to survive until the job spawns.
 */
const archiveBypass = new Set<number>();
const lastBroadcastAt = new Map<number, number>();
const rates = new Map<number, RateSample[]>();

// Slots are reserved synchronously when a job is picked up, because start()
// awaits before it spawns — counting `running` alone would overshoot the limit.
const active = new Set<number>();

let pumping = false;

export type DownloadRequest = {
  channel: Channel;
  settings: Settings;
  video: {
    videoId?: string | null;
    title?: string | null;
    link?: string | null;
  };
};

async function getRow(id: number): Promise<Download | undefined> {
  const [row] = await db.select().from(download).where(eq(download.id, id));
  return row;
}

async function emit(id: number) {
  const row = await getRow(id);
  if (row) broadcast("download-updated", Poster.decorate(row));
}

/**
 * Re-announces rows whose *derived* fields have moved without the row itself
 * changing — the artwork cache landing a thumbnail or an uploader avatar
 * after the download was already reported. posterFor() and avatarFor() read
 * the images directory at broadcast time, so a picture that arrives after the
 * last message leaves every open tab holding the row as it looked without it,
 * with nothing further scheduled to correct that.
 *
 * Read back from the database rather than decorating the caller's copies: the
 * artwork fetch outlives the download it belongs to, so those copies are
 * usually a "queued" snapshot of a row that has since finished, and sending
 * them would take the card backwards.
 */
export async function republish(ids: number[]): Promise<void> {
  if (!ids.length) return;

  const rows = await db.select().from(download).where(inArray(download.id, ids));

  // One message for however many rows share the picture that just landed —
  // an avatar is per channel, so a playlist expansion is a single event.
  if (rows.length) broadcast("downloads-batch", Poster.decorateAll(rows));
}

async function getSettings(): Promise<Settings | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row;
}

export async function enqueue(req: DownloadRequest): Promise<Download | null> {
  const url = req.video.link?.trim();

  if (!url) return null;

  const [row] = await db
    .insert(download)
    .values({
      watcherId: req.channel.id,
      channelId: req.channel.channelId,
      channelName: req.channel.name,
      videoId: req.video.videoId ?? null,
      title: req.video.title ?? null,
      url,
      status: "queued",
      // Watchers are YouTube RSS today, but read it off the link rather than
      // hardcoding it, so the row stays honest if that ever widens.
      platform: platformFromUrl(url),
      type: req.channel.type,
      format: req.channel.format,
      codec: req.channel.codec,
      // Written explicitly: the column default is SQLite's "YYYY-MM-DD HH:MM:SS"
      // while retry() and every other timestamp use ISO 8601. Both orderings
      // below are text comparisons, so one row in the other format sorts wrong.
      createdAt: new Date().toISOString()
    })
    .returning();

  broadcast("download-updated", Poster.decorate(row));

  void pump();

  return row;
}

/** The per-download settings a manual request carries instead of a channel. */
export type ManualOptions = {
  type: string;
  format: string;
  codec: string | null;
  quality: string | null;
  folder: string | null;
  prefix: string | null;
  ytdlpArgs: string | null;
  clipStart: string | null;
  clipEnd: string | null;
  removeSponsor: boolean;
  splitChapters: boolean;
};

/**
 * Queues one row per video for a manual request. A playlist or channel has
 * already been expanded into its entries by the caller, so each row is a
 * single video that can be retried or canceled on its own.
 */
export async function enqueueManual(
  entries: ResolvedEntry[],
  options: ManualOptions,
  playlist: { id: string | null; title: string | null } = { id: null, title: null }
): Promise<Download[]> {
  const usable = entries.filter((entry) => entry.url?.trim());

  const values: NewDownload[] = usable
    .map((entry) => ({
      watcherId: null,
      channelId: entry.channelId,
      channelName: entry.channelName,
      videoId: entry.videoId,
      title: entry.title,
      url: entry.url.trim(),
      duration: entry.duration,
      status: "queued",
      platform: entry.platform,
      source: "manual",
      type: options.type,
      format: options.format,
      codec: options.codec,
      quality: options.quality,
      folder: options.folder,
      prefix: options.prefix,
      ytdlpArgs: options.ytdlpArgs,
      clipStart: options.clipStart,
      clipEnd: options.clipEnd,
      removeSponsor: options.removeSponsor,
      splitChapters: options.splitChapters,
      playlistId: playlist.id,
      playlistTitle: playlist.title,
      playlistIndex: playlist.id ? entry.playlistIndex : null,
      // Same ISO format as every other timestamp — see enqueue() above.
      createdAt: new Date().toISOString()
    }));

  if (!values.length) return [];

  const rows = await db.insert(download).values(values).returning();

  // The resolve already extracted these pages; hand the result to the worker
  // so it does not do the same work again. returning() preserves insert
  // order, so rows line up with the entries they came from.
  await Promise.all(
    rows.map((row, index) => InfoCache.save(row.id, usable[index]?.info))
  );

  // One message for the whole batch: a channel expansion can be hundreds of
  // rows, and that many individual events would hammer every open tab.
  broadcast("downloads-batch", Poster.decorateAll(rows));

  void pump();

  return Poster.decorateAll(rows);
}

/**
 * Manual rows have no channel to read options from, so they carry their own.
 * Watcher rows still read the live channel, which means editing a channel
 * keeps affecting the downloads it has already queued.
 */
function optionsFromRow(row: Download): ytdlp.JobOptions {
  return {
    type: row.type ?? "video",
    format: row.format ?? "mp4",
    codec: row.codec,
    quality: row.quality,
    folder: row.folder,
    prefix: row.prefix,
    ytdlpArgs: row.ytdlpArgs,
    clipStart: row.clipStart,
    clipEnd: row.clipEnd,
    removeSponsor: !!row.removeSponsor,
    splitChapters: !!row.splitChapters,
    // The user asked for this file by name; "already in the archive" must not
    // silently turn that into a no-op.
    archiveWatcherId: null
  };
}

/**
 * Starts as many queued downloads as the concurrency limit allows.
 * Re-entrancy is guarded because every job completion calls back in.
 */
async function pump(): Promise<void> {
  if (pumping) return;

  pumping = true;

  try {
    const appSettings = await getSettings();
    const limit = Math.max(1, appSettings?.ytdlpConcurrency ?? 2);

    while (active.size < limit) {
      const [next] = await db
        .select()
        .from(download)
        .where(sql`status = 'queued'`)
        .orderBy(download.createdAt, download.id)
        .limit(1);

      if (!next) break;

      // Claim the row before awaiting anything else so it can't start twice.
      await db
        .update(download)
        .set({ status: "running", startedAt: new Date().toISOString() })
        .where(eq(download.id, next.id));

      active.add(next.id);

      void start(next.id).catch((e) => {
        console.error("Download error:", e);
        release(next.id);
      });
    }
  } finally {
    pumping = false;
  }
}

/** Frees a concurrency slot and lets the next queued job start. */
function release(id: number) {
  active.delete(id);
  archiveBypass.delete(id);
  running.delete(id);
  lastBroadcastAt.delete(id);
  rates.delete(id);
  ytdlp.releaseFilename(id);
}

async function start(id: number) {
  const row = await getRow(id);

  if (!row) {
    release(id);
    void pump();
    return;
  }

  const appSettings = await getSettings();

  if (!appSettings) {
    await finish(id, "failed", { error: "Settings unavailable" });
    release(id);
    void pump();
    return;
  }

  let ch: Channel | undefined;

  if (row.watcherId != null) {
    [ch] = await db.select().from(channel).where(eq(channel.id, row.watcherId));
  }

  const opts =
    row.source === "manual"
      ? optionsFromRow(row)
      : ch
        ? ytdlp.optionsFromChannel(ch)
        : null;

  if (!opts) {
    await finish(id, "failed", {
      error: "Subscription no longer exists, cannot resolve download options"
    });
    release(id);
    void pump();
    return;
  }

  if (archiveBypass.has(id)) opts.archiveWatcherId = null;

  // Cancel can land in the window between claiming the slot and spawning.
  if (row.status === "canceled") {
    release(id);
    void pump();
    return;
  }

  const bin = ytdlp.resolveBin();

  // An audio download with no artwork anywhere has only one possible picture:
  // a frame of the video it is extracted from, which yt-dlp deletes as soon
  // as the extraction is done. Keep it for the capture, and take the listing
  // of the destination first so the cleanup afterwards can tell the file this
  // job added from anything that was already sitting there.
  const keepVideo = opts.type === "audio" && needsPosterSource(row);

  if (keepVideo) opts.keepVideo = true;

  const homeBefore = keepVideo
    ? await ytdlp.listHome(opts, appSettings)
    : new Set<string>();

  // Probed once and cached, so only the first download of a run waits on it.
  // buildArgs reads the result synchronously.
  await Ffmpeg.status();

  // Reuse the resolve's extraction when it is still fresh. Watcher rows never
  // have one, so they are unaffected.
  const infoJsonPath = await InfoCache.pathIfFresh(id);
  const usedInfo = infoJsonPath !== null;

  const args = await ytdlp.buildArgs(
    opts,
    appSettings,
    row.url,
    id,
    row.title,
    infoJsonPath
  );

  await emit(id);

  const child = spawn(bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    // Python block-buffers a piped stdout, which would stall progress lines.
    env: { ...process.env, PYTHONUNBUFFERED: "1" }
  });

  running.set(id, child);

  let filePath: string | null = null;
  let stderrTail = "";

  const onStdout = (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith(ytdlp.PROGRESS_PREFIX)) {
        void handleProgress(id, line.slice(ytdlp.PROGRESS_PREFIX.length));
      } else if (line.startsWith(ytdlp.FILE_PREFIX)) {
        filePath = line.slice(ytdlp.FILE_PREFIX.length).trim();
      } else if (line.startsWith(ytdlp.DURATION_PREFIX)) {
        void handleDuration(id, line.slice(ytdlp.DURATION_PREFIX.length));
      }
    }
  };

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", onStdout);

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    // Keep only the tail; a failing download can produce a lot of output.
    stderrTail = (stderrTail + chunk).slice(-4000);
  });

  child.on("error", (e) => {
    stderrTail = `${stderrTail}\n${e.message}`.trim();
  });

  child.on("close", async (code, signal) => {
    release(id);

    const current = await getRow(id);

    if (current?.status === "canceled" || signal === "SIGTERM") {
      ytdlp.cleanupTemp(appSettings, id);
      autoRetries.delete(id);
      await finish(id, "canceled", { error: null });
    } else if (code === 0) {
      // Already empty on success — yt-dlp moved the finished file out of it.
      ytdlp.cleanupTemp(appSettings, id);
      autoRetries.delete(id);

      const output = resolveOutputPath(opts, filePath);

      // yt-dlp exits 0 without transferring anything when it decides the video
      // needs no work — an archive hit is the way that happens here. Nothing
      // was moved, so after_move never printed a path, and reporting that as
      // "done" leaves a finished download pointing at no file at all. Whatever
      // the reason, a job with no output did not succeed.
      if (!output) {
        const error =
          "yt-dlp finished without producing a file (already in this subscription's download archive?)";

        await finish(id, "failed", { error });
        broadcast("notification", {
          type: "error",
          title: "Download failed",
          subtitle: subtitleFor(current, ch),
          message: error
        });

        void pump();
        return;
      }

      await finish(id, "done", { filePath: output, progress: 100 });
      await onSuccess(ch, current);

      // Cosmetic and slower than the notification deserves to wait for.
      void finishArtwork(current, output, homeBefore);
    } else {
      const error = extractError(stderrTail) || `yt-dlp exited with code ${code}`;

      // Nothing is deleted on a failure: a partial transfer lets the next
      // attempt resume rather than start the whole download again, and a
      // failure after the bytes landed has a finished file in there. Boot
      // sweeps whatever is left over — see sweepAbandonedTemp().
      if (isFfmpegFailure(error)) {
        autoRetries.delete(id);
        await failFfmpeg(id, error, opts, appSettings, current, ch);
        void pump();
        return;
      }

      // The cached formats carry signed URLs that can expire before the job
      // reaches the front of the queue. Rather than guess which errors mean
      // "stale", drop the cache and let the job extract for itself — the
      // second attempt is the behaviour this refactor replaced, so the worst
      // case is simply the old cost. Dropping first makes a loop impossible.
      if (usedInfo) {
        await InfoCache.drop(id);
        await requeueTransient(id, 0, `${error} (retrying without cached info)`);
        void pump();
        return;
      }

      const spent = autoRetries.get(id) ?? 0;

      if (!isPermanent(error) && spent < MAX_AUTO_RETRIES) {
        autoRetries.set(id, spent + 1);
        await requeueTransient(id, spent + 1, error);
        void pump();
        return;
      }

      autoRetries.delete(id);
      await finish(id, "failed", { error });
      broadcast("notification", {
        type: "error",
        title: "Download failed",
        subtitle: subtitleFor(current, ch),
        message: error
      });
    }

    void pump();
  });
}

/**
 * A thumbnail job runs with --skip-download, so yt-dlp never moves a media
 * file and after_move cannot report a path. What it does print is the media
 * path it would have used, which differs only in extension.
 */
function resolveOutputPath(
  opts: ytdlp.JobOptions,
  filePath: string | null
): string | null {
  if (!filePath || opts.type !== "thumbnail") return filePath;

  return filePath.replace(/\.[^./\\]+$/, "") + ".jpg";
}

/**
 * Ends a job that fetched its video and then lost it to ffmpeg.
 *
 * These are the failures where the bytes are already on disk: the transfer
 * finished, and the merge, remux or fixup that follows is what fell over. The
 * file is sitting in the scratch directory, because yt-dlp only moves it to
 * its final home once every postprocessor has run — so it is moved here
 * instead, and the row points at it. Reported as a failure either way, since
 * a file that skipped its fixup is not quite the file that was asked for, but
 * a failure the user can play rather than one that left nothing behind.
 */
async function failFfmpeg(
  id: number,
  error: string,
  opts: ytdlp.JobOptions,
  appSettings: Settings,
  row: Download | undefined,
  ch: Channel | undefined
) {
  const rescued = await ytdlp.rescueTemp(opts, appSettings, id);

  const message = rescued
    ? `${error} — ffmpeg could not finish the file, so it was kept unprocessed`
    : error;

  await finish(id, "failed", {
    error: message,
    ...(rescued ? { filePath: rescued, progress: 100 } : {})
  });

  broadcast("notification", {
    type: rescued ? "warning" : "error",
    title: rescued ? "Downloaded, but ffmpeg failed" : "Download failed",
    subtitle: subtitleFor(row, ch),
    message
  });

  // The rescued file skipped its postprocessing but still plays, so the card
  // showing it can still have a picture.
  // An audio job's rescued file is the video it never got to extract, which
  // is a frame source rather than something to embed a cover into.
  if (rescued && row) void capturePoster(row, rescued);
}

/**
 * Clears scratch directories left behind by jobs that are no longer waiting
 * to run. A failed job keeps its partial files so a retry can resume from
 * them, which only works as long as something eventually collects the ones
 * whose download was deleted or given up on. Boot is that something: no job
 * is running yet, so every directory without a pending row is abandoned.
 */
async function sweepAbandonedTemp(): Promise<void> {
  const appSettings = await getSettings();

  if (!appSettings) return;

  const pending = await db
    .select({ id: download.id })
    .from(download)
    .where(inArray(download.status, ["queued", "running"]));

  const removed = await ytdlp.sweepTemp(
    appSettings,
    pending.map((r) => r.id)
  );

  if (removed) console.log(`download temp: cleared ${removed} abandoned folders`);
}

/** Manual downloads have no watcher, so the channel name may be all we have. */
function subtitleFor(row: Download | undefined, ch: Channel | undefined): string {
  const name = row?.channelName ?? ch?.name;

  return name ? `Channel: ${name}` : "Manual download";
}

async function onSuccess(ch: Channel | undefined, row: Download | undefined) {
  // Only watcher downloads count towards a channel's total.
  if (ch) {
    await db
      .update(channel)
      .set({ totalDownloads: sql`${channel.totalDownloads} + 1` })
      .where(eq(channel.id, ch.id));
  }

  broadcast("notification", {
    type: "success",
    title: "Downloaded",
    subtitle: subtitleFor(row, ch),
    message: row?.title ?? row?.url ?? ""
  });
}

/**
 * Whether a finished download still needs a poster taken out of its video.
 * True only for the rows that have no artwork anywhere — chiefly bare
 * `.m3u8` links, which arrive with no thumbnail metadata at all.
 */
function needsPosterSource(row: Download): boolean {
  if (row.type !== "video" && row.type !== "audio") return false;

  return !row.thumbnailPath && !Poster.hasCachedArtwork(row);
}

/**
 * Everything picture-related that happens once the bytes have landed: a
 * poster for a row that has none, and the poster written into the file for a
 * download that can carry one.
 *
 * Best effort throughout: the download has already succeeded, and every path
 * out of here that fails simply leaves the card as it is today.
 */
async function finishArtwork(
  row: Download | undefined,
  filePath: string | null,
  /** Names that were in the destination folder before this job ran. */
  before: Set<string>
) {
  if (!row || !filePath) return;

  // A thumbnail job's own download is the picture.
  if (row.type === "thumbnail") return;

  // Audio has no frames of its own; the video it was extracted from was kept
  // for exactly this, and is ours to remove once the frame is out of it.
  const source =
    row.type === "audio" ? await keptSource(filePath, before) : filePath;

  if (source) await capturePoster(row, source);

  if (source !== filePath) await discardKept(source);

  await embedCover(row, filePath);
}

async function capturePoster(row: Download, filePath: string) {
  // Whatever is already there was a better source than a frame grab.
  if (!needsPosterSource(row)) return;

  const poster = await Poster.capture({
    id: row.id,
    filePath,
    duration: row.duration
  });

  if (!poster) return;

  // The artwork fetch runs alongside the download (see manual-download.ts),
  // so a real thumbnail can land while ffmpeg is still decoding. It is the
  // better picture, and the UI prefers whatever is in this column — so having
  // lost the race, throw the frame away rather than override it.
  if (Poster.hasCachedArtwork(row)) {
    Poster.remove(row.id);
    return;
  }

  await db
    .update(download)
    .set({ thumbnailPath: poster })
    .where(eq(download.id, row.id));

  await emit(row.id);
}

/**
 * Writes the row's poster into the finished audio file as its cover art, so
 * a music player shows what the Downloads list shows. Read back from the
 * database rather than taken from `row`, because the frame grab above may
 * have just given this download its first picture.
 */
async function embedCover(row: Download, filePath: string) {
  if (row.type !== "audio" || !CoverArt.supports(filePath)) return;

  const current = await getRow(row.id);

  if (!current) return;

  const image = Poster.fileFor(current);

  if (image) await CoverArt.embed(filePath, image);
}

/**
 * Sidecars an audio job's own files can be named after: yt-dlp's thumbnail
 * and subtitle writers share the media's stem, and neither is something to
 * grab a frame from or delete.
 */
const SIDECAR_FILE = /\.(jpe?g|png|webp|gif|srt|vtt|ass|lrc|json|nfo|description|url)$/i;

/**
 * The video an audio job was told to keep, found next to the audio file it
 * became. yt-dlp names it after the same stem, so the pair differ only in
 * extension.
 *
 * A name that was already in the folder is never a candidate: the point of
 * the listing taken before the job is that this function decides what to
 * delete, and a file this download did not write is not ours to remove.
 */
async function keptSource(
  audioPath: string,
  before: Set<string>
): Promise<string | null> {
  const dir = path.dirname(audioPath);
  const audio = path.basename(audioPath);
  const stem = audio.slice(0, audio.length - path.extname(audio).length);

  let names: string[];

  try {
    names = await fsp.readdir(dir);
  } catch {
    return null;
  }

  const kept = names.find((name) => {
    if (name === audio || before.has(name)) return false;
    if (SIDECAR_FILE.test(name)) return false;

    return name.slice(0, name.length - path.extname(name).length) === stem;
  });

  return kept ? path.join(dir, kept) : null;
}

async function discardKept(target: string | null) {
  if (!target) return;

  try {
    // Never recursive: whatever this is meant to be, a directory is not it.
    if (!(await fsp.stat(target)).isFile()) return;

    await fsp.rm(target, { force: true });
  } catch (e) {
    console.warn("Could not remove kept video:", e);
  }
}

/**
 * yt-dlp prefixes real failures with "ERROR:"; surface that line rather than
 * the whole stderr tail, which is mostly warnings.
 */
function extractError(stderr: string): string | null {
  const line = stderr
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.includes("ERROR:"));

  return line?.trim().slice(0, 500) ?? null;
}

/** yt-dlp reports this once, before the first byte is fetched. */
async function handleDuration(id: number, payload: string) {
  const seconds = num(payload.trim());

  if (!seconds) return;

  await db
    .update(download)
    .set({ duration: Math.round(seconds) })
    .where(eq(download.id, id));

  await emit(id);
}

async function handleProgress(id: number, payload: string) {
  const [status, downloaded, total, totalEstimate] = payload.split("|");

  const totalBytes = num(total) ?? num(totalEstimate);
  const downloadedBytes = num(downloaded);

  const now = Date.now();

  // Fed every sample, including the bogus one below: its byte count is real,
  // and using it as the baseline saves a second of blank speed at the start.
  const bps =
    downloadedBytes == null ? null : trackRate(id, downloadedBytes, now);

  // yt-dlp's opening tick reports downloaded_bytes == total_bytes_estimate
  // (both the size of the first chunk), which would read as 100% instantly.
  // A download still in flight cannot be complete, so drop such samples and
  // wait for the next one, a second later, which carries a real estimate.
  const isBogusSample =
    status === "downloading" &&
    !!totalBytes &&
    !!downloadedBytes &&
    downloadedBytes >= totalBytes;

  if (isBogusSample) return;

  // DASH estimates routinely undershoot, so clamp until yt-dlp says finished.
  const progress =
    totalBytes && downloadedBytes
      ? Math.min(
          status === "finished" ? 100 : 99,
          Math.round((downloadedBytes / totalBytes) * 100)
        )
      : null;

  const last = lastBroadcastAt.get(id) ?? 0;
  const isFinal = status === "finished";

  if (!isFinal && now - last < PROGRESS_BROADCAST_MS) return;

  lastBroadcastAt.set(id, now);

  await db
    .update(download)
    .set({
      progress: progress ?? undefined,
      totalBytes: totalBytes ? Math.round(totalBytes) : undefined,
      speed: formatSpeed(bps),
      eta: formatEta(etaSeconds(bps, downloadedBytes, totalBytes))
    })
    .where(eq(download.id, id));

  await emit(id);
}

/**
 * Wall-clock throughput across a fixed window of progress samples. The window
 * matters more than the smoothing: fragments land in lumps many seconds
 * apart, so a rate measured between two consecutive ticks reads as zero
 * during a gap and as the burst rate the instant one arrives. Averaging over
 * a span that comfortably contains several fragments is what makes the
 * number stable. Returns null until two samples are far enough apart.
 */
function trackRate(id: number, bytes: number, now: number): number | null {
  const samples = rates.get(id) ?? [];
  const latest = samples[samples.length - 1];

  // A retried fragment re-reports bytes already counted, and merging a video
  // and audio stream restarts the count from zero. Start a fresh window
  // rather than measure across the discontinuity.
  if (latest && bytes < latest.bytes) {
    rates.set(id, [{ at: now, bytes }]);
    return null;
  }

  samples.push({ at: now, bytes });

  // Drop the oldest sample only while the one behind it still spans the full
  // window, so the measured span never shrinks below RATE_WINDOW_MS.
  while (samples.length > 2 && now - samples[1].at >= RATE_WINDOW_MS) {
    samples.shift();
  }

  rates.set(id, samples);

  const oldest = samples[0];
  const elapsed = now - oldest.at;

  if (elapsed < RATE_MIN_SAMPLE_MS) return null;

  return ((bytes - oldest.bytes) / elapsed) * 1000;
}

/**
 * Derived from our own rate so the two never contradict each other. The
 * total is an estimate for fragmented downloads, so this moves as yt-dlp
 * revises it — but it tracks reality, which the reported ETA did not.
 */
function etaSeconds(
  bps: number | null,
  downloadedBytes: number | null,
  totalBytes: number | null
): number | null {
  if (!bps || bps <= 0 || !totalBytes || downloadedBytes == null) return null;

  const remaining = totalBytes - downloadedBytes;

  return remaining > 0 ? remaining / bps : null;
}

function num(value: string | undefined): number | null {
  if (!value || value === "NA") return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatSpeed(bytesPerSecond: number | null): string | null {
  if (!bytesPerSecond) return null;

  const units = ["B/s", "KB/s", "MB/s", "GB/s"];

  let value = bytesPerSecond;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatEta(seconds: number | null): string | null {
  if (seconds == null) return null;

  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  // A genuinely slow download can run for hours, and "148m 12s" is a number
  // the reader has to do arithmetic on before it means anything.
  if (h) return `${h}h ${m}m`;

  return m ? `${m}m ${s}s` : `${s}s`;
}

async function finish(
  id: number,
  status: "done" | "failed" | "canceled",
  patch: { error?: string | null; filePath?: string | null; progress?: number }
) {
  // Terminal either way, so the cached extraction has no further use.
  void InfoCache.drop(id);

  await db
    .update(download)
    .set({
      status,
      finishedAt: new Date().toISOString(),
      speed: null,
      eta: null,
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.filePath !== undefined ? { filePath: patch.filePath } : {}),
      ...(patch.progress !== undefined ? { progress: patch.progress } : {})
    })
    .where(eq(download.id, id));

  await emit(id);
}

export async function cancel(id: number): Promise<boolean> {
  const row = await getRow(id);

  if (!row) return false;

  if (row.status === "queued") {
    await finish(id, "canceled", { error: null });
    return true;
  }

  const child = running.get(id);

  if (!child) return false;

  // Mark first so the close handler knows this was deliberate.
  await db
    .update(download)
    .set({ status: "canceled" })
    .where(eq(download.id, id));

  child.kill("SIGTERM");

  return true;
}

/**
 * Emergency stop for the whole queue. A playlist or channel can queue
 * hundreds of jobs, and cancelling them one request at a time is far too
 * slow — so the rows are cleared in a single statement and announced as one
 * batch, rather than a round trip and a broadcast per download.
 */
export async function cancelAll(): Promise<Download[]> {
  // Mark first, then kill: a child's close handler reads the row to decide
  // whether it died deliberately, and must see "canceled" rather than
  // reporting a failure.
  const rows = await db
    .update(download)
    .set({
      status: "canceled",
      finishedAt: new Date().toISOString(),
      speed: null,
      eta: null,
      error: null
    })
    .where(inArray(download.status, ["queued", "running"]))
    .returning();

  for (const child of running.values()) {
    child.kill("SIGTERM");
  }

  if (rows.length) broadcast("downloads-batch", Poster.decorateAll(rows));

  return rows;
}

/**
 * Puts a job back in the queue after a transient extractor failure, keeping
 * its place in the ordering — `createdAt` is deliberately untouched, unlike
 * the user-initiated retry() below, so an automatic attempt does not jump the
 * queue. The row stays "queued" throughout, so the UI shows it as still
 * pending rather than flashing a failure the app is already handling.
 */
async function requeueTransient(
  id: number,
  attempt: number,
  error: string
): Promise<void> {
  const label =
    attempt > 0
      ? `transient extractor failure (attempt ${attempt}/${MAX_AUTO_RETRIES})`
      : "cached info unusable";

  console.warn(`download ${id}: ${label}, requeueing: ${error}`);

  await db
    .update(download)
    .set({
      status: "queued",
      progress: 0,
      speed: null,
      eta: null,
      error: null,
      filePath: null,
      startedAt: null
    })
    .where(eq(download.id, id));

  await emit(id);

  // Let the challenge settle before asking for it again.
  await new Promise((resolve) => setTimeout(resolve, AUTO_RETRY_DELAY_MS));
}

export async function retry(id: number): Promise<Download | null> {
  const row = await getRow(id);

  if (!row || row.status === "running" || row.status === "queued") return null;

  await db
    .update(download)
    .set({
      status: "queued",
      progress: 0,
      speed: null,
      eta: null,
      error: null,
      filePath: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date().toISOString()
    })
    .where(eq(download.id, id));

  archiveBypass.add(id);

  await emit(id);

  void pump();

  return getRow(id).then((r) => (r ? Poster.decorate(r) : null));
}

/** Called on boot so downloads requeued after a crash actually start. */
export function resume() {
  // Before anything spawns, so a running job's scratch space is never in
  // scope, and its own row is still "queued" if the crash left it that way.
  void sweepAbandonedTemp().finally(() => pump());
}
