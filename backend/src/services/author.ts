import type { Download } from "../db/types.js";

/**
 * Where the uploader of a download row lives on their own site.
 *
 * Resolved here rather than in the client for the same reason avatarFor() is
 * (see avatar.ts): which column names the uploader is a per-site fact, and
 * the client would have to keep a copy of it in a template. It also has no
 * way to tell an id apart from a handle — the client's own version sent every
 * TikTok row to `tiktok.com/@MS4wLjABAAAA…`, the opaque sec_uid we store as
 * channelId, which is not a profile URL at all.
 *
 * Null means the row has no author page to point at: a site the app knows
 * nothing about, or an uploader whose id never came back with the metadata.
 * The client renders that as a plain, unclickable avatar.
 */

/**
 * The character set TikTok and Instagram both allow in a handle. Worth
 * checking rather than trusting `channelName`: that column holds whatever
 * yt-dlp called the uploader, which on some extractors is a display name
 * ("Дом 2") that names no page.
 */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

/** A YouTube channel id is always "UC" plus 22 more chars. */
const YT_CHANNEL = /^UC[\w-]{22}$/;

/** `tiktok.com/@handle/video/…` — the handle straight from the source URL. */
const TIKTOK_HANDLE = /tiktok\.com\/@([A-Za-z0-9._]+)/i;

export function authorUrlFor(row: Download): string | null {
  switch (row.platform) {
    case "youtube":
      return YT_CHANNEL.test(row.channelId ?? "")
        ? `https://www.youtube.com/channel/${row.channelId}`
        : null;

    // The URL the row was queued from carries the handle, and is the only
    // place it survives unambiguously — prefer it to the uploader metadata.
    case "tiktok": {
      const handle = row.url.match(TIKTOK_HANDLE)?.[1] ?? row.channelName;

      return HANDLE.test(handle ?? "") ? `https://www.tiktok.com/@${handle}` : null;
    }

    // Instagram's uploader_id is numeric and addresses nothing; the handle is
    // what `channelName` holds.
    case "instagram":
      return HANDLE.test(row.channelName ?? "")
        ? `https://www.instagram.com/${row.channelName}`
        : null;

    default:
      return null;
  }
}
