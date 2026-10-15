import { FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import path from "node:path";

import { isInside, ROOT } from "../../services/paths.js";

/**
 * A hard cap on one answer. A folder holding thousands of entries is a
 * library, not a shelf someone picks from by eye; past this the client is
 * told the list was cut and can narrow it by typing.
 */
const MAX_ENTRIES = 1000;

/**
 * Entries nobody is choosing: dotfiles (our own scratch space among them),
 * the recycle bins NAS shares leave behind, and macOS/Windows metadata.
 */
function isHidden(name: string): boolean {
  return name.startsWith(".") || name === "@eaDir" || name === "$RECYCLE.BIN";
}

type Entry = {
  name: string;
  type: "folder" | "file";
  /**
   * A folder that is a separate filesystem — a ZFS dataset, a btrfs
   * subvolume, another disk. Moving a file into it is a copy, not a rename.
   */
  mount: boolean;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export async function foldersRoutes(app: FastifyInstance) {
  /**
   * One level of the mounted root, for the path autocomplete: the folders
   * directly inside `path` (relative to the root, "" or absent for the root
   * itself), and with `files=1` the files there too — folders first. Read one
   * level at a time as the user types, so a large library is never walked as
   * a whole.
   *
   * Symlinks are not listed: one pointing outside the root would offer a
   * destination every write refuses, and one pointing back up would let the
   * client step in circles.
   */
  app.get("/api/folders", async (req, reply) => {
    const query = req.query as { path?: string; files?: string };
    const withFiles = query.files === "1" || query.files === "true";

    const wanted = (query.path ?? "").replace(/^[\\/]+/, "");

    if (wanted.includes("\0") || wanted.split(/[\\/]+/).some((s) => s === "..")) {
      return reply.code(400).send({ error: "Invalid path" });
    }

    let realRoot: string;
    let dir: string;

    try {
      realRoot = await fsp.realpath(ROOT);
      dir = await fsp.realpath(path.resolve(realRoot, wanted));
    } catch {
      return reply.code(404).send({ error: "No folder at that path" });
    }

    if (!isInside(dir, realRoot)) {
      return reply.code(403).send({ error: "Folder is outside the downloads folder" });
    }

    const own = await fsp.stat(dir).catch(() => null);

    if (!own?.isDirectory()) {
      return reply.code(404).send({ error: "No folder at that path" });
    }

    let dirents;

    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return reply.code(403).send({ error: "Folder cannot be read" });
    }

    const visible = dirents.filter(
      (d) => !isHidden(d.name) && (d.isDirectory() || (withFiles && d.isFile()))
    );

    const entries: Entry[] = await Promise.all(
      visible.map(async (d) => {
        if (!d.isDirectory()) return { name: d.name, type: "file" as const, mount: false };

        const stats = await fsp.stat(path.join(dir, d.name)).catch(() => null);

        return { name: d.name, type: "folder" as const, mount: !!stats && stats.dev !== own.dev };
      })
    );

    entries.sort((a, b) =>
      a.type === b.type ? collator.compare(a.name, b.name) : a.type === "folder" ? -1 : 1
    );

    return {
      path: path.relative(realRoot, dir).split(path.sep).join("/"),
      entries: entries.slice(0, MAX_ENTRIES),
      truncated: entries.length > MAX_ENTRIES
    };
  });
}
