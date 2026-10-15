import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * The directory mounted into the container, and the edge of everything the
 * app may read, serve, rename or delete. Every path the user sees or types —
 * `filePath`, a subscription's folder, the downloads folder setting — is
 * relative to it, so it reads the same as the mounted folder does in a file
 * manager on the host. Fixed at boot: settings only choose where inside it
 * new downloads land, never how much of it the app can see.
 */
export const ROOT = path.resolve(process.env.DOWNLOADS_DIR ?? "/downloads");

let realRoot: string | null = null;

/**
 * ROOT with symlinks resolved, for comparing against realpaths. Cached once it
 * resolves; until the volume is there, ROOT itself stands in.
 */
export function realRootSync(): string {
  if (realRoot) return realRoot;

  try {
    realRoot = fs.realpathSync(ROOT);

    return realRoot;
  } catch {
    return ROOT;
  }
}

/** Whether `abs` is `root` or somewhere inside it. Safe for a root of "/". */
export function isInside(abs: string, root: string = ROOT): boolean {
  const rel = path.relative(root, abs);

  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * A path as the app stores and shows it: relative to ROOT, "" for ROOT
 * itself. Null for anything outside it. Accepts realpaths as well, since
 * those are what the containment checks hand back.
 */
export function toRelative(abs: string): string | null {
  const resolved = path.resolve(abs);

  for (const root of new Set([ROOT, realRootSync()])) {
    if (isInside(resolved, root)) return path.relative(root, resolved);
  }

  return null;
}

/**
 * The real location of a stored or typed path. Relative values are taken
 * from ROOT; absolute ones are passed through, so this is safe to call on a
 * value that was already converted.
 */
export function toAbsolute(value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(ROOT, value);
}

export type FolderResult = { ok: true; folder: string } | { ok: false; error: string };

/**
 * A folder as typed into a form or the API, relative to ROOT. "" and "/" both
 * mean ROOT; a leading or trailing slash means nothing. "." and ".." are
 * refused rather than quietly dropped: "./x" reads as relative to the
 * downloads folder to some and to the root to others, and guessing wrong
 * files the download somewhere the user did not mean.
 */
export function parseFolder(value: unknown): FolderResult {
  if (value == null) return { ok: true, folder: "" };

  if (typeof value !== "string") return { ok: false, error: "Folder must be a string" };

  if (value.includes("\0")) return { ok: false, error: "Folder contains invalid characters" };

  const segments = value
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, error: "Folder must not contain \".\" or \"..\"" };
  }

  return { ok: true, folder: segments.join("/") };
}

/**
 * A destination folder for a download or a subscription, as sent by a client.
 * Left out, null or blank takes `fallback` (the downloads folder setting);
 * the root has to be asked for with "/". Unlike the setting itself, where
 * empty is the root: a form field left empty means "the usual place".
 */
export function parseFolderOr(value: unknown, fallback: string): FolderResult {
  if (value == null || (typeof value === "string" && !value.trim())) {
    return { ok: true, folder: fallback };
  }

  return parseFolder(value);
}

/**
 * The downloads folder setting as a folder relative to ROOT. A value that no
 * longer parses — saved before the rules above — falls back to ROOT rather
 * than failing every download that relies on it.
 */
export function downloadsFolder(setting: string | null | undefined): string {
  const parsed = parseFolder(setting);

  return parsed.ok ? parsed.folder : "";
}

/**
 * Scratch space for `.part` files, staging and frame clips. Dot-prefixed so
 * media scanners skip it.
 */
export const TEMP_DIR_NAME = ".retriever-tmp";

/**
 * The highest folder above `dir`, inside ROOT, that is still on the same
 * filesystem as `dir` — ROOT itself unless a separate dataset, subvolume or
 * disk is mounted somewhere inside it. A finished file only moves into its
 * folder by rename when the scratch space shares the filesystem; across one
 * it is a full copy, so each filesystem gets scratch space of its own.
 *
 * `dir` need not exist yet: the walk starts from the nearest folder that does,
 * which is on the filesystem the missing ones will be created on.
 */
export async function filesystemTop(dir: string): Promise<string> {
  let current = path.resolve(dir);

  if (!isInside(current)) return ROOT;

  let dev: number | null = null;

  while (dev == null) {
    const stats = await fsp.stat(current).catch(() => null);

    if (stats?.isDirectory()) {
      dev = stats.dev;
    } else if (current === ROOT) {
      return ROOT;
    } else {
      current = path.dirname(current);
    }
  }

  while (current !== ROOT) {
    const parent = path.dirname(current);
    const stats = await fsp.stat(parent).catch(() => null);

    if (!stats || stats.dev !== dev) break;

    current = parent;
  }

  return current;
}

/** The scratch folder for files headed to `dir`. See filesystemTop(). */
export async function tempRootFor(dir: string): Promise<string> {
  return path.join(await filesystemTop(dir), TEMP_DIR_NAME);
}

/**
 * Every filesystem mounted below ROOT, by its mount point — the places
 * tempRootFor() can have put scratch space besides ROOT itself. Read from the
 * kernel's mount table so nothing has to walk the library to find them; empty
 * where there is no such table, which leaves ROOT as the only candidate.
 */
export async function mountsInside(): Promise<string[]> {
  let table: string;

  try {
    table = await fsp.readFile("/proc/self/mountinfo", "utf8");
  } catch {
    return [];
  }

  const roots = new Set([ROOT, realRootSync()]);
  const found = new Set<string>();

  for (const line of table.split("\n")) {
    // Field 5 is the mount point, with space, tab, newline and backslash
    // written as octal escapes.
    const field = line.split(" ")[4];

    if (!field) continue;

    const mountPoint = field.replace(/\\([0-7]{3})/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 8))
    );

    for (const root of roots) {
      if (mountPoint !== root && isInside(mountPoint, root)) {
        found.add(path.join(ROOT, path.relative(root, mountPoint)));
      }
    }
  }

  return [...found];
}
