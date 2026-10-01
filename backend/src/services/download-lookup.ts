import { and, desc, eq, inArray, type SQL } from "drizzle-orm";

import { db } from "../db/index.js";
import { download } from "../db/schema.js";
import type { Download } from "../db/types.js";

/**
 * How a pasted URL is matched against the rows it produced, without running
 * yt-dlp. A lookup happens every time the extension popup opens, so it has to
 * be a query, not a resolve.
 *
 * YouTube has many spellings of one video (youtu.be, /shorts/, &t=…) and rows
 * store the canonical watch URL, so those match on the video id instead. A
 * playlist matches the rows its expansion was tagged with. Anything else —
 * direct media, HLS manifests, other sites — can only match the URL as given.
 */
export type LookupKey =
  | { by: "video"; videoId: string }
  | { by: "playlist"; playlistId: string }
  | { by: "url"; url: string };

/** What the lookup answers with: the latest attempt at each item, per type. */
export type DownloadLookup = Record<"video" | "audio", Download[]>;

const LOOKUP_TYPES = ["video", "audio"] as const;

/** Bounds the scan for a URL someone has downloaded absurdly often. */
const MAX_ROWS = 2000;

const YT_HOST = /(^|\.)(youtube|youtube-nocookie)\.com$/i;
const YT_SHORT_HOST = /(^|\.)youtu\.be$/i;
const YT_ID = /^[\w-]{11}$/;

/** Paths that carry the video id as their second segment. */
const YT_ID_PATHS = new Set(["shorts", "live", "embed", "v"]);

export function lookupKey(raw: string): LookupKey | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (YT_SHORT_HOST.test(url.hostname)) {
    const id = url.pathname.split("/")[1] ?? "";
    return YT_ID.test(id) ? { by: "video", videoId: id } : { by: "url", url: trimmed };
  }

  if (YT_HOST.test(url.hostname)) {
    const [, first = "", second = ""] = url.pathname.split("/");
    const id = first === "watch" ? url.searchParams.get("v") ?? "" : YT_ID_PATHS.has(first) ? second : "";

    // A watch URL inside a playlist still names one video; its row carries
    // the id whether it was queued alone or as part of the playlist.
    if (YT_ID.test(id)) return { by: "video", videoId: id };

    const list = url.searchParams.get("list");
    if (list) return { by: "playlist", playlistId: list };
  }

  return { by: "url", url: trimmed };
}

function whereFor(key: LookupKey): SQL {
  switch (key.by) {
    case "video":
      return and(eq(download.platform, "youtube"), eq(download.videoId, key.videoId))!;
    case "playlist":
      return eq(download.playlistId, key.playlistId);
    case "url":
      return eq(download.url, key.url);
  }
}

/**
 * The newest row for every item the URL stands for, split by type. Retrying a
 * video leaves the failed attempt behind, and a playlist queued twice has two
 * rows per video — only the latest one says where that item stands now.
 */
export async function lookupDownloads(key: LookupKey): Promise<DownloadLookup> {
  const rows = await db
    .select()
    .from(download)
    .where(and(whereFor(key), inArray(download.type, [...LOOKUP_TYPES])))
    .orderBy(desc(download.id))
    .limit(MAX_ROWS);

  const result: DownloadLookup = { video: [], audio: [] };
  const seen = new Set<string>();

  for (const row of rows) {
    const type = row.type as keyof DownloadLookup;
    const item = `${type}:${row.videoId ?? row.url}`;

    if (seen.has(item)) continue;

    seen.add(item);
    result[type].push(row);
  }

  return result;
}
