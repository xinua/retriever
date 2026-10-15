import fsp from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { download } from "../db/schema.js";
import { broadcast } from "../routes/ws/websockets.js";
import { resolveDownloadFile, withFileExists } from "./download-file.js";
import { busyError, claimFile, releaseFile } from "./file-busy.js";
import * as Poster from "./poster.js";
import * as ytdlp from "./ytdlp.js";

import type { Download } from "../db/types.js";

/**
 * Renames a download — two separate actions, never one implying the other.
 *
 * `retitleDownload` changes the title the list shows and nothing else. The
 * file on disk is named `<prefix><title>< (N)>.<ext>`, a mapping the user
 * never sees, so deriving one from the other made renames that could not be
 * undone.
 *
 * `renameDownloadFile` renames the file to exactly the name typed, given
 * without the extension — the file keeps its own. Nothing else is added,
 * stripped or substituted, so what the user saw is what lands on disk.
 * A name that cannot be used as typed is refused rather than fixed up. The
 * move is a `rename` within one folder: no bytes are copied, which matters on
 * the NAS, and Plex sees one file disappear and one appear.
 */

/** Longer than any real video title; keeps a pasted essay out of the column. */
const MAX_TITLE_LENGTH = 300;

/** What ext4, btrfs and most SMB shares allow for one name, in bytes. */
const MAX_NAME_BYTES = 255;

/**
 * Characters no file name may hold here: path separators and NUL, plus what
 * Windows refuses over SMB. yt-dlp never writes the latter either — see
 * `ytdlp.sanitizeTitle` — so a file renamed here stays readable from every
 * client the share has.
 */
const FORBIDDEN_CHARS = /[\\/\0"*:<>?|\x01-\x1f\x7f]/;

export type RenameResult =
  | { ok: true; download: Download & { fileExists: boolean } }
  | { ok: false; status: number; error: string };

export async function retitleDownload(
  row: Download,
  value: unknown
): Promise<RenameResult> {
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: "title is required" };
  }

  const title = value.replace(/\s+/g, " ").trim();

  if (!title) return { ok: false, status: 400, error: "title is required" };

  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, status: 400, error: `title must be at most ${MAX_TITLE_LENGTH} characters` };
  }

  // The worker writes the title when the job finishes.
  if (row.status === "queued" || row.status === "running") {
    return { ok: false, status: 409, error: "Download is still active" };
  }

  const [checked] = await withFileExists([await update(row.id, { title })]);

  return { ok: true, download: publish(checked) };
}

export async function renameDownloadFile(
  row: Download,
  value: unknown
): Promise<RenameResult> {
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: "fileName is required" };
  }

  // Only the ends: spaces inside a name are part of it.
  const stem = value.trim();

  if (!stem) return { ok: false, status: 400, error: "fileName is required" };

  // The worker writes filePath when the job finishes.
  if (row.status === "queued" || row.status === "running") {
    return { ok: false, status: 409, error: "Download is still active" };
  }

  // Also keeps a double submit from racing itself.
  if (!claimFile(row.id, "renaming")) {
    return { ok: false, status: 409, error: busyError(row.id) };
  }

  try {
    const file = await resolveDownloadFile(row);

    if (!file.ok) return file;

    // The extension is what players and Plex go by, so it is never changed.
    const name = stem + path.extname(file.filename);
    const invalid = invalidName(name);

    if (invalid) return { ok: false, status: 400, error: invalid };

    const dir = path.dirname(file.path);
    const target = path.join(dir, name);

    if (target === file.path) {
      return { ok: true, download: publish({ ...row, fileExists: true }) };
    }

    if ((await ytdlp.isFilenameClaimed(dir, name)) || (await takenByAnother(target, file.path))) {
      return { ok: false, status: 409, error: `"${name}" already exists` };
    }

    await fsp.rename(file.path, target);

    let updated: Download;

    try {
      updated = await update(row.id, { filePath: target });
    } catch (e) {
      // The row still names the old path, so put the file back under it.
      await fsp.rename(target, file.path).catch(() => {});
      throw e;
    }

    return { ok: true, download: publish({ ...updated, fileExists: true }) };
  } finally {
    releaseFile(row.id);
  }
}

/** Why `name` cannot be used as a file name as typed, or null when it can. */
function invalidName(name: string): string | null {
  if (FORBIDDEN_CHARS.test(name)) {
    return 'File name cannot contain / \\ " * : < > ? | or control characters';
  }

  // Also covers "." and "..". A leading dot hides the file from Plex and
  // from most file browsers.
  if (name.startsWith(".")) return "File name cannot start with a dot";

  // Windows drops these silently, so the share would show a different name.
  if (/[. ]$/.test(name)) return "File name cannot end with a dot or a space";

  if (Buffer.byteLength(name) > MAX_NAME_BYTES) return "File name is too long";

  return null;
}

/**
 * Whether `target` is a different file than `source`. A case-only rename on a
 * case-insensitive share (SMB) finds `source` itself there, which is fine.
 */
async function takenByAnother(target: string, source: string): Promise<boolean> {
  try {
    return (await fsp.realpath(target)) !== source;
  } catch (e: any) {
    // A dangling symlink is still a name that rename would replace.
    if (e?.code !== "ENOENT") return true;

    return fsp.lstat(target).then(() => true, () => false);
  }
}

async function update(id: number, values: { title: string } | { filePath: string }) {
  const [updated] = await db
    .update(download)
    .set(values)
    .where(eq(download.id, id))
    .returning();

  return updated;
}

/** The row as clients see it, pushed to every open tab and returned. */
function publish(row: Download & { fileExists: boolean }) {
  const decorated = { ...Poster.decorate(row), fileExists: row.fileExists };

  broadcast("download-updated", decorated);

  return decorated;
}
