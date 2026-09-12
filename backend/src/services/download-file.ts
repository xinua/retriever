import fsp from "node:fs/promises";
import path from "node:path";

import * as ytdlp from "./ytdlp.js";

import type { Download, Settings } from "../db/types.js";

export type ResolvedFile =
  | { ok: true; path: string; size: number; filename: string }
  | { ok: false; status: number; error: string };

/**
 * Resolves the file a download row points at, and refuses anything outside
 * the downloads folder.
 *
 * `filePath` is written by yt-dlp rather than typed by a user, but the output
 * template is reachable through the extra-arguments field (`-o`, `-P`), so a
 * row can be made to point anywhere on disk. Without this check the endpoint
 * would read any file the server process can see. Both sides are resolved
 * through realpath so a symlink planted inside the folder cannot be used to
 * step out of it either.
 */
export async function resolveDownloadFile(
  row: Download,
  settings: Settings
): Promise<ResolvedFile> {
  // A path, not a status, is what says a file exists: a job that downloaded
  // the video and then failed in postprocessing keeps the file it produced,
  // and the row that points at it is "failed". Rows still in flight have no
  // path, so this stays as strict as the status check was.
  if (!row.filePath?.trim()) {
    return { ok: false, status: 409, error: "This download has no file on disk" };
  }

  const realRoot = await realDownloadsRoot(settings);

  if (!realRoot) {
    return { ok: false, status: 500, error: "Downloads folder is not available" };
  }

  return resolveInsideRoot(row.filePath.trim(), realRoot);
}

async function realDownloadsRoot(settings: Settings): Promise<string | null> {
  try {
    return await fsp.realpath(ytdlp.downloadsRoot(settings));
  } catch {
    return null;
  }
}

async function resolveInsideRoot(filePath: string, realRoot: string): Promise<ResolvedFile> {
  let realFile: string;

  try {
    realFile = await fsp.realpath(filePath);
  } catch {
    // Deleted, moved, or on an unmounted volume since the download finished.
    return { ok: false, status: 410, error: "File is no longer on disk" };
  }

  const contained =
    realFile === realRoot || realFile.startsWith(realRoot + path.sep);

  if (!contained) {
    return {
      ok: false,
      status: 403,
      error: "File is outside the downloads folder"
    };
  }

  let stats: Awaited<ReturnType<typeof fsp.stat>>;

  try {
    stats = await fsp.stat(realFile);
  } catch {
    // Removed between the realpath above and this call.
    return { ok: false, status: 410, error: "File is no longer on disk" };
  }

  if (!stats.isFile()) {
    return { ok: false, status: 403, error: "Not a regular file" };
  }

  return {
    ok: true,
    path: realFile,
    size: stats.size,
    filename: path.basename(realFile)
  };
}

export type WithFileExists<T> = T & { fileExists: boolean };

/**
 * Tells each row whether the file endpoint would serve it right now, so a
 * client can offer play and save only where they will work — without a probe
 * per row, and without a 404 in the console for every file deleted outside
 * the app.
 *
 * Only the rows being answered with are checked, never the whole table: this
 * runs on every page of the listing, and a page is a few dozen stat calls
 * where the table is tens of thousands. The checks run in parallel and are
 * exactly the ones `resolveDownloadFile` applies, so `true` here means the
 * endpoint will stream the bytes rather than fail a moment later.
 *
 * The answer is computed per response and never written back. `filePath`
 * keeps pointing where the file was: a downloads folder that is not mounted
 * yet makes every file look gone, and erasing the paths then would lose them
 * for good once the volume came back. The kept path is also what "Set file
 * path" starts from when a file really was moved.
 *
 * Queued and running rows are never checked — a file that is still being
 * written, or about to be, is not missing.
 */
export async function withFileExists<T extends Download>(
  rows: T[],
  settings: Settings
): Promise<WithFileExists<T>[]> {
  const candidates = rows.filter(
    (row) => row.status !== "queued" && row.status !== "running" && row.filePath?.trim()
  );

  // One realpath of the root for the whole page rather than one per row; when
  // it is missing, nothing inside it can be served and no row is looked at.
  const realRoot = candidates.length ? await realDownloadsRoot(settings) : null;

  const found = new Set<number>();

  if (realRoot) {
    await Promise.all(
      candidates.map(async (row) => {
        const file = await resolveInsideRoot(row.filePath!.trim(), realRoot);

        if (file.ok) found.add(row.id);
      })
    );
  }

  return rows.map((row) => ({ ...row, fileExists: found.has(row.id) }));
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".opus": "audio/opus",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip"
};

export function contentTypeFor(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Content-Disposition is a latin-1 header, but these filenames are whatever
 * the video was called — Cyrillic, CJK, emoji. RFC 5987 covers that with a
 * `filename*` parameter; the plain `filename` stays as an ASCII fallback for
 * anything that does not read the extended form.
 *
 * `inline` is for the in-page player: the same bytes, but presented as
 * something to render rather than something to save.
 */
export function contentDisposition(filename: string, inline = false): string {
  const ascii = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();

  const fallback = ascii || "download";

  const type = inline ? "inline" : "attachment";

  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Parses a single-range `Range` header against a known size. Multi-range
 * requests are ignored (returning null serves the whole file), which is what
 * every browser expects for a plain attachment download.
 */
export function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;

  if (!rawStart) {
    // "bytes=-500" — the final 500 bytes.
    const suffix = Number(rawEnd);

    if (!suffix) return "unsatisfiable";

    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return "unsatisfiable";

  return { start, end: Math.min(end, size - 1) };
}

/**
 * Resolves a path someone typed into the "set file path" field to the file it
 * names, or explains why it cannot be used.
 *
 * Re-pointing does not move anything: it corrects the row to a file that is
 * already on disk — after a library was reorganised outside the app, or a
 * download was renamed by hand. So the target has to exist, and the checks
 * are the same ones `resolveDownloadFile` applies when serving a file. A row
 * pointed at something unreadable would fail at the download endpoint
 * instead, long after the mistake was made.
 *
 * The value is taken relative to the downloads root — the shape `/api/folders`
 * suggests and the form's `<dir>/<fileName>.<ext>` placeholder asks for — but
 * an absolute path is accepted too, so the string that "copy file path" put on
 * the clipboard can be pasted back and edited.
 *
 * Nothing here sanitizes: the target must match a real name on disk, and
 * yt-dlp's own names carry spaces, full-width look-alikes and non-latin
 * scripts that any rewriting would break. Containment is enforced by
 * comparing realpaths instead, so neither `..` nor a planted symlink can
 * point the row outside the downloads folder.
 */
export async function resolveNewFilePath(
  value: string,
  settings: Settings
): Promise<ResolvedFile> {
  const wanted = value.trim();

  if (!wanted) {
    return { ok: false, status: 400, error: "A file path is required" };
  }

  // A NUL byte truncates the path at the syscall boundary, so what is checked
  // here would not be what is opened later.
  if (wanted.includes("\0")) {
    return { ok: false, status: 400, error: "File path contains invalid characters" };
  }

  let realRoot: string;

  try {
    realRoot = await fsp.realpath(ytdlp.downloadsRoot(settings));
  } catch {
    return { ok: false, status: 500, error: "Downloads folder is not available" };
  }

  const candidate = path.isAbsolute(wanted)
    ? path.resolve(wanted)
    : path.resolve(realRoot, wanted);

  let realFile: string;

  try {
    realFile = await fsp.realpath(candidate);
  } catch {
    return { ok: false, status: 404, error: "No file at that path" };
  }

  const contained =
    realFile === realRoot || realFile.startsWith(realRoot + path.sep);

  if (!contained) {
    return {
      ok: false,
      status: 403,
      error: "File is outside the downloads folder"
    };
  }

  const stats = await fsp.stat(realFile);

  if (!stats.isFile()) {
    return { ok: false, status: 409, error: "Not a regular file" };
  }

  return {
    ok: true,
    path: realFile,
    size: stats.size,
    filename: path.basename(realFile)
  };
}
