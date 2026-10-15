import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { download } from "../db/schema.js";
import { broadcast } from "../routes/ws/websockets.js";
import { resolveDownloadFile, withFileExists } from "./download-file.js";
import { busyError, claimFile, releaseFile, setMoveProgress } from "./file-busy.js";
import { isInside, parseFolder, realRootSync, ROOT, tempRootFor } from "./paths.js";
import * as Poster from "./poster.js";
import * as ytdlp from "./ytdlp.js";

import type { Download } from "../db/types.js";

/**
 * Moves a download's file to another folder inside the root, under the same
 * name, and points the row at it.
 *
 * Within one filesystem that is a hard link at the new path and an unlink of
 * the old one: no bytes are copied, and unlike `rename` a link never replaces
 * a file already there — the kernel refuses it in the same call. Across
 * filesystems (a separate dataset or disk mounted inside the root) the file
 * is copied into scratch space beside the destination, linked into place
 * from there, and only then is the original deleted. The copy runs in the
 * background and reports progress over the websocket; until it is linked in
 * it can be canceled, and the original is untouched either way.
 *
 * Nothing but the record's own file is ever deleted. A folder left empty
 * stays, and a missing destination folder is created.
 *
 * Every step is ordered so a crash costs at most a duplicate, never the file:
 * the new copy is complete before it gets its name, the row follows it, and
 * the original goes last.
 */

export type MoveResult =
  | { ok: true; status: 200 | 202; download: Presented }
  | { ok: false; status: number; error: string };

type Presented = Awaited<ReturnType<typeof present>>;

/** How often a copy's progress goes out to clients. */
const PROGRESS_INTERVAL_MS = 500;

/** Copies under way, so they can be canceled. */
const copies = new Map<number, AbortController>();

export async function moveDownloadFile(row: Download, value: unknown): Promise<MoveResult> {
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: "folder is required" };
  }

  const parsed = parseFolder(value);

  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  // The worker writes filePath when the job finishes.
  if (row.status === "queued" || row.status === "running") {
    return { ok: false, status: 409, error: "Download is still active" };
  }

  if (!claimFile(row.id, "moving")) {
    return { ok: false, status: 409, error: busyError(row.id) };
  }

  let background = false;

  try {
    const file = await resolveDownloadFile(row);

    if (!file.ok) return file;

    const dir = await prepareFolder(parsed.folder);

    if (!dir.ok) return dir;

    if (dir.path === path.dirname(file.path)) {
      return { ok: true, status: 200, download: await present(row.id) };
    }

    const target = path.join(dir.path, file.filename);
    const taken = { ok: false as const, status: 409, error: `"${file.filename}" already exists in ${shown(parsed.folder)}` };

    if ((await ytdlp.isFilenameClaimed(dir.path, file.filename)) || (await exists(target))) {
      return taken;
    }

    const source = await fsp.stat(file.path);
    const placed = await place(file.path, target);

    if (placed === "exists") return taken;

    if (placed !== "cross") {
      await pointRowAt(row.id, target, async () => {
        // Put it back the way it came: a link is dropped, a rename undone.
        if (placed === "linked") await fsp.unlink(target);
        else await fsp.rename(target, file.path);
      });

      if (placed === "linked") await unlinkIfSame(file.path, source);

      return { ok: true, status: 200, download: publish(await present(row.id)) };
    }

    background = true;
    setMoveProgress(row.id, { copied: 0, total: source.size });
    void copyAcross(row.id, file.path, source, target, parsed.folder);

    return { ok: true, status: 202, download: publish(await present(row.id)) };
  } finally {
    if (!background) releaseFile(row.id);
  }
}

/**
 * Stops a copy to another filesystem. False when there is none to stop — never
 * started, finished, or already past the point where the copy got its name.
 */
export function cancelMove(id: number): boolean {
  const controller = copies.get(id);

  if (!controller) return false;

  controller.abort();
  copies.delete(id);

  return true;
}

type FolderCheck = { ok: true; path: string } | { ok: false; status: number; error: string };

/**
 * The real location of `folder`, created when missing. Checked against the
 * root by realpath both before and after creating it, so a symlink inside the
 * root cannot be used to move a file — or create folders — outside it.
 */
async function prepareFolder(folder: string): Promise<FolderCheck> {
  const wanted = path.join(ROOT, folder);
  const outside = { ok: false as const, status: 403, error: "Folder is outside the downloads folder" };

  if (!isInside(await nearestReal(wanted), realRootSync())) return outside;

  try {
    await fsp.mkdir(wanted, { recursive: true });
  } catch (e: any) {
    if (e?.code === "EEXIST" || e?.code === "ENOTDIR") {
      return { ok: false, status: 400, error: `${shown(folder)} is a file, not a folder` };
    }

    throw e;
  }

  const real = await fsp.realpath(wanted);

  if (!isInside(real, realRootSync())) return outside;

  return { ok: true, path: real };
}

/** The realpath of `p`, or of the closest folder above it that exists. */
async function nearestReal(p: string): Promise<string> {
  let current = p;

  for (;;) {
    try {
      return path.join(await fsp.realpath(current), path.relative(current, p));
    } catch {
      const parent = path.dirname(current);

      if (parent === current) return p;

      current = parent;
    }
  }
}

/**
 * Gives `from` the name `to` without replacing anything at `to`.
 *
 * "linked" leaves `from` in place for the caller to remove once the row
 * follows; "renamed" is the fallback where hard links are not supported (some
 * FUSE and SMB mounts), with a check just before it standing in for the
 * kernel's — a file dropped there in between would be replaced, which is as
 * close as those filesystems allow. "cross" means `to` is on another
 * filesystem, or another mount of the same one, which neither call crosses.
 */
async function place(from: string, to: string): Promise<"linked" | "renamed" | "exists" | "cross"> {
  try {
    await fsp.link(from, to);

    return "linked";
  } catch (e: any) {
    if (e?.code === "EEXIST") return "exists";
    if (e?.code === "EXDEV") return "cross";
    if (e?.code !== "EPERM" && e?.code !== "ENOTSUP" && e?.code !== "ENOSYS" && e?.code !== "EOPNOTSUPP") throw e;
  }

  if (await exists(to)) return "exists";

  try {
    await fsp.rename(from, to);

    return "renamed";
  } catch (e: any) {
    if (e?.code === "EXDEV") return "cross";

    throw e;
  }
}

/**
 * The background half of a move to another filesystem. Never throws: the
 * outcome reaches clients as the row itself and a notification.
 */
async function copyAcross(
  id: number,
  from: string,
  source: fs.Stats,
  target: string,
  folder: string
): Promise<void> {
  const controller = new AbortController();

  // Before anything is awaited, so a cancel right after the 202 finds it.
  copies.set(id, controller);

  let scratch: string | null = null;
  let error: string | null = null;

  try {
    // Beside the destination, on its filesystem, so the finished copy gets
    // its name by a link rather than a second copy.
    scratch = path.join(await tempRootFor(path.dirname(target)), `move-${id}`);

    const copy = path.join(scratch, path.basename(target));

    await fsp.mkdir(scratch, { recursive: true });
    await copyWithProgress(id, from, copy, source.size, controller.signal);

    // Same metadata as the original, so the library sees the same file — a
    // fresh mtime would sort it as new in Plex.
    await fsp.chmod(copy, source.mode & 0o7777).catch(() => {});
    await fsp.utimes(copy, source.atime, source.mtime).catch(() => {});

    if (!(await isSame(from, source))) {
      error = "The file changed while it was being copied";
      return;
    }

    // Past this point the move finishes or fails, but is no longer canceled.
    if (controller.signal.aborted) return;

    copies.delete(id);

    const placed = await place(copy, target);

    if (placed === "exists") {
      error = `"${path.basename(target)}" already exists in ${shown(folder)}`;
      return;
    }

    if (placed === "cross") throw new Error("Scratch space is not on the destination filesystem");

    await pointRowAt(id, target, async () => {
      if (placed === "linked") await fsp.unlink(target);
      else await fsp.rename(target, copy);
    });

    await unlinkIfSame(from, source);
  } catch (e: any) {
    if (!controller.signal.aborted) {
      console.warn(`move: download ${id} to ${shown(folder)} failed:`, e);
      error = e?.code === "ENOSPC" ? "Not enough space at the destination" : String(e?.message ?? e);
    }
  } finally {
    copies.delete(id);
    if (scratch) await fsp.rm(scratch, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
    releaseFile(id);

    const row = await present(id).catch(() => null);

    if (row) publish(row);

    if (error) {
      broadcast("notification", { type: "error", title: "Move failed", subtitle: row?.title ?? undefined, message: error });
    } else if (controller.signal.aborted) {
      broadcast("notification", { type: "info", title: "Move canceled", subtitle: row?.title ?? undefined, message: "The file stayed where it was" });
    } else {
      broadcast("notification", { type: "success", title: "File moved", subtitle: row?.title ?? undefined, message: `Moved to ${shown(folder)}` });
    }
  }
}

/**
 * Copies `from` to `to`, which must not exist. A reflink is tried first: on
 * ZFS with block cloning, btrfs or XFS it shares the blocks rather than
 * writing them again, and finishes at once. Otherwise the bytes are streamed,
 * which — unlike `copyFile` — can report how far it got and be stopped.
 */
async function copyWithProgress(id: number, from: string, to: string, total: number, signal: AbortSignal): Promise<void> {
  try {
    await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE_FORCE);
    setMoveProgress(id, { copied: total, total });

    return;
  } catch {
    // No reflinks here, or not between these two; a partial file is not
    // left by a failed clone, but a stale one from a crash might be.
    await fsp.rm(to, { force: true });
  }

  let copied = 0;
  let sentAt = 0;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      copied += chunk.length;
      setMoveProgress(id, { copied, total });

      const now = Date.now();

      if (now - sentAt >= PROGRESS_INTERVAL_MS) {
        sentAt = now;
        void present(id).then(publish, () => {});
      }

      done(null, chunk);
    }
  });

  await pipeline(fs.createReadStream(from), counter, fs.createWriteStream(to, { flags: "wx" }), { signal });
}

/**
 * Points the row at `target`. If that fails the row still names the old
 * path, so `undo` takes the new name away again before the error goes on.
 */
async function pointRowAt(id: number, target: string, undo: () => Promise<void>): Promise<void> {
  try {
    await db.update(download).set({ filePath: target }).where(eq(download.id, id));
  } catch (e) {
    await undo().catch(() => {});
    throw e;
  }
}

/**
 * Deletes the original once its row has moved on — but only while it is still
 * the very file that was moved. Anything else at that path now is not the
 * app's to delete.
 */
async function unlinkIfSame(file: string, before: fs.Stats): Promise<void> {
  if (await isSame(file, before)) await fsp.unlink(file).catch(() => {});
}

async function isSame(file: string, before: fs.Stats): Promise<boolean> {
  const now = await fsp.lstat(file).catch(() => null);

  return !!now && now.ino === before.ino && now.dev === before.dev && now.size === before.size && now.mtimeMs === before.mtimeMs;
}

/** Whether anything at all has the name `p`, a dangling symlink included. */
async function exists(p: string): Promise<boolean> {
  return fsp.lstat(p).then(() => true, () => false);
}

/** A folder as the user typed it, for messages. */
function shown(folder: string): string {
  return `"${folder || "/"}"`;
}

async function present(id: number) {
  const [row] = await db.select().from(download).where(eq(download.id, id));

  if (!row) throw new Error(`Download ${id} is gone`);

  const [checked] = await withFileExists([Poster.decorate(row)]);

  return checked;
}

/** The row as clients see it, pushed to every open tab and returned. */
function publish<T>(row: T): T {
  broadcast("download-updated", row);

  return row;
}
