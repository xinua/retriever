import { ImagesService } from "./images.service.js";

import type { Download } from "../db/types.js";

/**
 * Which picture stands for the uploader of a download row.
 *
 * Decided here rather than in the client for the same reason posterFor() is
 * (see poster.ts): only the server can see whether the avatar it went out to
 * fetch actually landed. The client used to build `/images/channel-<id>.jpg`
 * for every YouTube row and let the 404 fall through to a placeholder, which
 * cost a red console line per row and a broken image on the way there.
 *
 * Off YouTube there is no per-uploader picture to fetch — TikTok and
 * Instagram ids are not addressable as avatars the way a YouTube channel is —
 * so those rows get the site's own mark instead, served from the frontend's
 * static assets like any other bundled image.
 */

/** Where the bundled per-site marks live, relative to the served web root. */
const ASSETS = "/assets/images";

/**
 * A bare HLS manifest, which the generic extractor knows nothing else about.
 * Worth its own mark rather than the "unknown site" one: it is the one such
 * URL people paste on purpose, and it says what the row actually is.
 */
const M3U8_URL = /\.m3u8(\?|#|$)/i;

const SITE_MARK: Partial<Record<Download["platform"], string>> = {
  tiktok: `${ASSETS}/tiktok.webp`,
  instagram: `${ASSETS}/instagram.webp`
};

/**
 * The uploader picture a row should show, as a path the browser can load, or
 * null when the row has none — a YouTube channel whose avatar was never
 * fetched, which the client renders as its "not found" stand-in.
 */
export function avatarFor(row: Download): string | null {
  if (row.platform === "youtube") {
    if (!row.channelId) return null;

    const name = `channel-${row.channelId}.jpg`;

    return ImagesService.exists(name) ? `/images/${name}` : null;
  }

  const mark = SITE_MARK[row.platform];

  if (mark) return mark;

  return M3U8_URL.test(row.url) ? `${ASSETS}/m3u8.webp` : `${ASSETS}/unknown.webp`;
}
