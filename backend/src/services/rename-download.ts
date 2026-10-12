import fsp from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { download } from "../db/schema.js";
import { broadcast } from "../routes/ws/websockets.js";
import { isEmbedding } from "./artwork-replace.js";
import { resolveDownloadFile } from "./download-file.js";
import * as Poster from "./poster.js";
import * as ytdlp from "./ytdlp.js";

import type { Download, Settings } from "../db/types.js";

/**
 * Renames a download: the title the list shows, and the file on disk with it.
 *
 * The file keeps its folder, its extension and whatever sits around the title
 * in its name — the channel or manual prefix, a " (2)" copy number — so only
 * the part that *was* the title changes. That part is found by sanitising the
 * old title the way yt-dlp did when it named the file (`sanitizeTitle`). A
 * file renamed by hand no longer contains it, and is then named
 * `<prefix><title>` from scratch.
 *
 * The move is a `rename` within one folder: no bytes are copied, which
 * matters on the NAS, and Plex sees one file disappear and one appear.
 *
 * A row with no file — failed before writing anything, or the file is gone —
 * only has its title changed; `fileRenamed` says which of the two happened.
 */

/** Longer than any real video title; keeps a pasted essay out of the column. */
const MAX_TITLE_LENGTH = 300;

/** What ext4, btrfs and most SMB shares allow for one name, in bytes. */
const MAX_NAME_BYTES = 255;

export type RenameResult =
  | { ok: true; download: Download & { fileExists: boolean }; fileRenamed: boolean }
  | { ok: false; status: number; error: string };

/** Downloads mid-rename, so a double submit cannot race itself. */
const renaming = new Set<number>();

export async function renameDownload(
  row: Download,
  value: unknown,
  appSettings: Settings
): Promise<RenameResult> {
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: "title is required" };
  }

  const title = value.replace(/\s+/g, " ").trim();

  if (!title) return { ok: false, status: 400, error: "title is required" };

  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, status: 400, error: `title must be at most ${MAX_TITLE_LENGTH} characters` };
  }

  // The worker writes both title and filePath when the job finishes.
  if (row.status === "queued" || row.status === "running") {
    return { ok: false, status: 409, error: "Download is still active" };
  }

  if (renaming.has(row.id) || isEmbedding(row.id)) {
    return { ok: false, status: 409, error: "The file is already being updated" };
  }

  renaming.add(row.id);

  try {
    const file = await resolveDownloadFile(row, appSettings);

    // No file to follow the title: nothing written, deleted, or an unmounted
    // volume. The kept filePath still points where the file was.
    if (!file.ok) {
      if (file.status === 403) return file;

      return { ok: true, download: await save(row.id, { title }, false), fileRenamed: false };
    }

    const target = path.join(path.dirname(file.path), renamedFile(file.filename, row, title));

    if (target === file.path) {
      return { ok: true, download: await save(row.id, { title }, true), fileRenamed: false };
    }

    if (Buffer.byteLength(path.basename(target)) > MAX_NAME_BYTES) {
      return { ok: false, status: 400, error: "title is too long for a file name" };
    }

    if (await takenByAnother(target, file.path)) {
      return { ok: false, status: 409, error: "Another file with that name already exists" };
    }

    await fsp.rename(file.path, target);

    try {
      return {
        ok: true,
        download: await save(row.id, { title, filePath: target }, true),
        fileRenamed: true
      };
    } catch (e) {
      // The row still names the old path, so put the file back under it.
      await fsp.rename(target, file.path).catch(() => {});
      throw e;
    }
  } finally {
    renaming.delete(row.id);
  }
}

/**
 * The new file name: the old one with its title part swapped, or
 * `<prefix><title>.<ext>` when the old title cannot be found in it.
 */
function renamedFile(filename: string, row: Download, title: string): string {
  const { name: stem, ext } = path.parse(filename);
  const next = ytdlp.sanitizeTitle(title);
  const previous = row.title?.trim() ? ytdlp.sanitizeTitle(row.title) : "";

  // Last occurrence: a prefix can repeat a word of the title, a suffix after
  // the title is only ever a copy number or a chapter marker.
  const at = previous ? stem.lastIndexOf(previous) : -1;

  if (at === -1) {
    return `${ytdlp.sanitizeSegment(row.prefix, { keepTrailingSpace: true })}${next}${ext}`;
  }

  // The copy number only told this file apart from another of the old title;
  // under the new one it is noise. A name that is taken is refused instead.
  const suffix = stem.slice(at + previous.length).replace(/^ \(\d+\)/, "");

  return `${stem.slice(0, at)}${next}${suffix}${ext}`;
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

async function save(
  id: number,
  values: { title: string; filePath?: string },
  fileExists: boolean
) {
  const [updated] = await db
    .update(download)
    .set(values)
    .where(eq(download.id, id))
    .returning();

  const decorated = { ...Poster.decorate(updated), fileExists };

  broadcast("download-updated", decorated);

  return decorated;
}
