import { execFile } from "node:child_process";
import { promisify } from "node:util";

import * as ytdlp from "./ytdlp.js";
import { platformFromNode, type Platform } from "./platform.js";
import { isPermanent } from "./retry-policy.js";

import type { Settings } from "../db/types.js";

const execFileAsync = promisify(execFile);

/**
 * A channel can hold thousands of videos, and every one of them becomes a row,
 * a websocket message and a card in the UI. Cap the expansion so one paste
 * cannot flood the queue; the response reports when the cap was hit.
 */
export const MAX_ITEMS = Number(process.env.MAX_MANUAL_ITEMS ?? 500);

const RESOLVE_TIMEOUT_MS = 120_000;

/**
 * A resolve runs before any download row exists, so a single unlucky
 * extraction shows the user an error and queues nothing at all — there is no
 * row left behind for the download queue's retry to rescue. This is the only
 * place that failure can be absorbed.
 *
 * Five is chosen from measurement, not taste: TikTok's JS challenge was
 * failing about half of all attempts when this was written (7 of 14 in one
 * sample), which leaves ~3% of resolves failing here against ~12% at three
 * attempts. Failed attempts return in a couple of seconds, so the cost of the
 * extra headroom is only paid on a page that is already misbehaving.
 */
const RESOLVE_ATTEMPTS = 5;

const RESOLVE_RETRY_DELAY_MS = 1500;

// A channel listing is a lot of JSON even flattened.
const RESOLVE_MAX_BUFFER = 128 * 1024 * 1024;

export type ResolvedEntry = {
  videoId: string | null;
  title: string | null;
  url: string;
  channelId: string | null;
  channelName: string | null;
  duration: number | null;
  thumbnail: string | null;
  playlistIndex: number | null;
  /**
   * The complete info dict yt-dlp returned for this entry, when the resolve
   * produced one. A `--flat-playlist` listing yields stubs with no formats,
   * so only a single-video resolve fills this in — which is exactly the case
   * that would otherwise extract the same page twice.
   */
  info: unknown | null;
  /**
   * Which site the entry came from. Callers use it to gate the YouTube-only
   * guesses (i.ytimg.com stills, /channel/<id> avatar lookups) that are
   * meaningless for a TikTok or Instagram id.
   */
  platform: Platform;
};

export type ResolvedTarget = {
  kind: "video" | "playlist" | "channel";
  playlistId: string | null;
  playlistTitle: string | null;
  entries: ResolvedEntry[];
  /** True when the source held more videos than MAX_ITEMS. */
  truncated: boolean;
};

const CHANNEL_ROOT =
  /^\/(@[^/]+|c\/[^/]+|user\/[^/]+|channel\/[^/]+)\/?$/i;

const CHANNEL_TAB =
  /\/(videos|shorts|streams|live|playlists|featured|community|releases)\/?$/i;

/**
 * A bare channel URL resolves to a list of tabs (Videos, Shorts, Live…) rather
 * than a list of videos, which would nest one level deeper than we want. Point
 * at the Videos tab instead so the entries are the videos themselves.
 */
export function normalizeTarget(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  const isYouTube = /(^|\.)youtube\.com$/i.test(url.hostname);

  if (!isYouTube) return url.toString();
  if (CHANNEL_TAB.test(url.pathname)) return url.toString();
  if (!CHANNEL_ROOT.test(url.pathname)) return url.toString();

  url.pathname = `${url.pathname.replace(/\/$/, "")}/videos`;

  return url.toString();
}

export function isChannelTarget(raw: string): boolean {
  try {
    const url = new URL(raw.trim());

    return (
      /(^|\.)youtube\.com$/i.test(url.hostname) &&
      (CHANNEL_ROOT.test(url.pathname) || CHANNEL_TAB.test(url.pathname))
    );
  } catch {
    return false;
  }
}

/**
 * `--flat-playlist` on a channel can still return playlists inside playlists
 * (a tab holding sections), so walk down to the leaves. Depth is bounded
 * because a malformed feed should not be able to recurse forever.
 *
 * Collects one more than the cap so the caller can tell "exactly full" from
 * "there was more".
 */
function collectEntries(node: any, out: any[], depth = 0): void {
  if (!node || depth > 3 || out.length > MAX_ITEMS) return;

  if (Array.isArray(node.entries)) {
    for (const entry of node.entries) {
      collectEntries(entry, out, depth + 1);

      if (out.length > MAX_ITEMS) return;
    }

    return;
  }

  // A leaf without an id is a placeholder (deleted or members-only video).
  if (node.id) out.push(node);
}

/** The channel a listing belongs to, for entries that don't repeat it. */
type ParentInfo = {
  channelId: string | null;
  channelName: string | null;
};

/**
 * A .webp still would be served from /images/<id>.jpg, so prefer a real jpg.
 * Every YouTube video has one at a predictable address, which is also the
 * fallback when the flat listing carries no thumbnails at all.
 */
function pickThumbnail(node: any, platform: Platform): string | null {
  const candidates: string[] = [
    ...(Array.isArray(node?.thumbnails)
      ? node.thumbnails.map((t: any) => t?.url).filter(Boolean).reverse()
      : []),
    ...(typeof node?.thumbnail === "string" ? [node.thumbnail] : [])
  ];

  const jpg = candidates.find((url) => !/\.webp(\?|$)/i.test(url));

  if (jpg) return jpg;

  // The i.ytimg.com guess only means anything for a YouTube id.
  return node?.id && platform === "youtube"
    ? `https://i.ytimg.com/vi/${node.id}/hqdefault.jpg`
    : null;
}

/** YouTube video ids are 11 chars of [A-Za-z0-9_-] — and so are Instagram
 * shortcodes, so the shape alone can never tell them apart. Only the
 * extractor that produced the node can. */
const YT_ID = /^[\w-]{11}$/;

/** A YouTube channel id is always "UC" plus 22 more chars. */
const YT_CHANNEL = /^UC[\w-]{22}$/;

/**
 * A flat listing can omit both the extractor and the URL on individual
 * entries, so a YouTube-shaped channel id ("UC" + 22) is accepted as
 * corroboration rather than mislabelling a whole playlist as unknown.
 */
function resolvePlatform(node: any, parent: ParentInfo): Platform {
  const platform = platformFromNode(node);

  if (platform !== "unknown") return platform;

  const channelId = String(node?.channel_id ?? parent.channelId ?? "");

  return YT_CHANNEL.test(channelId) ? "youtube" : "unknown";
}

/**
 * A flat YouTube listing can hand back a bare video id instead of a URL, which
 * is why we ever synthesize a watch URL at all. Every other site gives a real
 * page URL, so that always wins — rebuilding one from the id sent Instagram
 * reels (shortcode "DcDvw2OxfGQ") to youtube.com/watch?v=DcDvw2OxfGQ.
 */
function entryUrl(
  node: any,
  videoId: string | null,
  platform: Platform
): string {
  const direct =
    (typeof node?.webpage_url === "string" && node.webpage_url) ||
    (typeof node?.url === "string" && node.url) ||
    "";

  if (/^https?:\/\//i.test(direct)) return direct;

  if (videoId && YT_ID.test(videoId) && platform === "youtube") {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  return direct;
}

function toEntry(node: any, index: number, parent: ParentInfo): ResolvedEntry {
  const videoId: string | null = node?.id ?? null;
  const platform = resolvePlatform(node, parent);

  return {
    videoId,
    title: node?.title ?? null,
    url: entryUrl(node, videoId, platform),
    // A channel tab omits the channel on every entry, since the listing
    // itself is the channel — fall back to the listing's own metadata.
    channelId: node?.channel_id ?? node?.uploader_id ?? parent.channelId,
    channelName: node?.channel ?? node?.uploader ?? parent.channelName,
    duration: Number.isFinite(node?.duration) ? Math.round(node.duration) : null,
    thumbnail: pickThumbnail(node, platform),
    playlistIndex: node?.playlist_index ?? index + 1,
    // Formats are the part a download actually needs; a flat stub has none.
    info: Array.isArray(node?.formats) && node.formats.length ? node : null,
    platform
  };
}

/**
 * A channel tab's own id is the channel id ("UC…"); a playlist's is not, so
 * only the former is worth inheriting.
 */
function parentInfo(data: any): ParentInfo {
  const fromId = typeof data?.id === "string" && YT_CHANNEL.test(data.id)
    ? data.id
    : null;

  return {
    channelId: data?.channel_id ?? data?.uploader_id ?? fromId,
    channelName: data?.channel ?? data?.uploader ?? null
  };
}

/**
 * Turns a pasted URL into the list of videos it stands for, without
 * downloading anything. One video comes back as a single entry; a playlist or
 * channel comes back as one entry per video.
 */
export async function resolveTarget(
  rawUrl: string,
  settings: Settings,
  /**
   * The request's own yt-dlp arguments. Resolving reads the page just like a
   * download does, so flags such as --referer or --cookies must apply here
   * too — without them a site that needs them fails before a row is queued.
   */
  requestArgs: string | null = null,
  /**
   * How many entries of a playlist to read. A subscription scan only cares
   * about the newest handful, and every hundred more is another page fetch.
   */
  limit: number = MAX_ITEMS
): Promise<ResolvedTarget> {
  const target = normalizeTarget(rawUrl);

  const args = [
    "-J",
    "--flat-playlist",
    "--no-warnings",
    "--ignore-no-formats-error",
    // One unavailable video in a playlist must not fail the whole resolve.
    "--ignore-errors",
    "--playlist-end", String(Math.min(limit, MAX_ITEMS) + 1)
  ];

  if (settings.cookiesPath?.trim()) {
    args.push("--cookies", settings.cookiesPath.trim());
  }

  // Resolving goes through the same YouTube extractor a download does, so it
  // needs the JS runtime and the POT provider just as much.
  args.push(...ytdlp.jsRuntimeArgs());
  args.push(...ytdlp.potArgs());
  args.push(...ytdlp.tokenizeArgs(settings.ytdlpArgs));
  args.push(...ytdlp.tokenizeArgs(requestArgs));
  args.push("--", target);

  let data: any = null;
  let lastError = "Could not read that URL";

  for (let attempt = 1; attempt <= RESOLVE_ATTEMPTS; attempt++) {
    const result = await runResolveOnce(args);

    if (result.ok) {
      data = result.data;
      break;
    }

    lastError = result.error;

    if (isPermanent(lastError) || attempt === RESOLVE_ATTEMPTS) break;

    console.warn(
      `resolve: attempt ${attempt}/${RESOLVE_ATTEMPTS} failed, retrying: ${lastError}`
    );

    await new Promise((r) => setTimeout(r, RESOLVE_RETRY_DELAY_MS));
  }

  if (!data) throw new Error(lastError);

  const isPlaylist = data?._type === "playlist" || Array.isArray(data?.entries);
  return buildTarget(rawUrl, data, isPlaylist);
}

type ResolveOnce =
  | { ok: true; data: any }
  | { ok: false; error: string };

/** One extraction attempt: spawn yt-dlp and turn its output into a dict. */
async function runResolveOnce(args: string[]): Promise<ResolveOnce> {
  let stdout: string;
  let failure: unknown = null;

  try {
    ({ stdout } = await execFileAsync(ytdlp.resolveBin(), args, {
      timeout: RESOLVE_TIMEOUT_MS,
      maxBuffer: RESOLVE_MAX_BUFFER
    }));
  } catch (e: any) {
    // --ignore-errors still exits non-zero, but usually after printing usable
    // JSON. Fall back to the error's stdout before giving up.
    failure = e;
    stdout = e?.stdout ?? "";

    if (!stdout.trim()) {
      return {
        ok: false,
        error: extractResolveError(e) ?? "Could not read that URL"
      };
    }
  }

  let data: any;

  try {
    data = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      error: "yt-dlp returned an unreadable response for that URL"
    };
  }

  // When extraction fails outright, --ignore-errors makes yt-dlp print a bare
  // "null" and exit non-zero. That parses cleanly but describes no video, so
  // without this the real reason (on stderr) is lost and the caller reports a
  // misleading "No downloadable videos found at that URL".
  if (!data || typeof data !== "object") {
    return {
      ok: false,
      error: extractResolveError(failure) ?? "Could not read that URL"
    };
  }

  return { ok: true, data };
}

/** Shapes one resolved dict into the target the caller asked for. */
function buildTarget(
  rawUrl: string,
  data: any,
  isPlaylist: boolean
): ResolvedTarget {

  if (!isPlaylist) {
    const single: ParentInfo = { channelId: null, channelName: null };

    return {
      kind: "video",
      playlistId: null,
      playlistTitle: null,
      entries: data?.id ? [toEntry(data, 0, single)] : [],
      truncated: false
    };
  }

  const nodes: any[] = [];
  collectEntries(data, nodes);

  const parent = parentInfo(data);
  const truncated = nodes.length > MAX_ITEMS;

  const entries = nodes
    .slice(0, MAX_ITEMS)
    .map((node, index) => toEntry(node, index, parent))
    .filter((entry) => entry.url);

  return {
    kind: isChannelTarget(rawUrl) ? "channel" : "playlist",
    playlistId: data?.id ?? null,
    playlistTitle: data?.title ?? null,
    entries,
    truncated
  };
}

function extractResolveError(e: any): string | null {
  const stderr: string = e?.stderr ?? e?.message ?? "";

  const lines = stderr.split(/\r?\n/).map((l: string) => l.trim());

  // Prefer a real ERROR line; yt-dlp prints the useful one last when it
  // retried. Fall back to any non-empty output so the user still sees why.
  const errors = lines.filter((l: string) => l.includes("ERROR:"));
  const chosen = errors.at(-1) ?? lines.filter(Boolean).at(-1);

  if (!chosen) return null;

  // The boilerplate "please report this issue ..." tail is noise in a toast.
  return chosen
    .replace(/;\s*please report this issue.*$/i, "")
    .trim()
    .slice(0, 500);
}
