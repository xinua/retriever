import Parser from "rss-parser";

import { resolveTarget } from "./resolve.js";

import type { Settings } from "../db/types.js";

const parser = new Parser({
  customFields: {
    item: [
      ['media:group', 'mediaGroup'],
      ['media:description', ['mediaGroup', 'media:description']],
      ['media:thumbnail', ['mediaGroup', 'media:thumbnail']],
    ],
  },
});

export type RssVideo = {
  videoId: string | null
  title?: string
  description?: string
  thumbnail?: string
  link?: string
  published?: string
};

export type RssFeedResult = {
  /** Newest first, as the feed orders them. Empty when nothing was returned. */
  videos: RssVideo[]
};

/**
 * YouTube's feed endpoint fails in waves - for hours at a time most requests
 * answer 404 or 500, for a feed that is perfectly fine a second later. A
 * couple of quick retries ride out the scattered failures; when the feed is
 * down for good, the channel's uploads are listed with yt-dlp instead.
 */
const FEED_ATTEMPTS = 3;
const FEED_RETRY_DELAY_MS = 1500;
const FEED_TIMEOUT_MS = 15_000;

/** About what the feed itself carries. */
const UPLOADS_LIMIT = 15;

/** 404 and 5xx are how the outages look; anything else is a real answer. */
function isFeedOutage(status: number): boolean {
  return status === 404 || status >= 500;
}

async function fetchFeedXml(rssUrl: string): Promise<string> {
  let lastError = "RSS fetch failed";

  for (let attempt = 1; attempt <= FEED_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(rssUrl, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });

      if (res.ok) return await res.text();

      lastError = `RSS fetch failed: ${res.status}`;

      if (!isFeedOutage(res.status)) break;
    } catch (e: any) {
      lastError = `RSS fetch failed: ${e?.message ?? e}`;
    }

    if (attempt < FEED_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, FEED_RETRY_DELAY_MS));
    }
  }

  throw new Error(lastError);
}

/** The UC… id a channel feed URL names, or null for any other feed. */
function channelIdOf(rssUrl: string): string | null {
  try {
    const id = new URL(rssUrl).searchParams.get("channel_id");
    return id && /^UC[\w-]{22}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The channel's newest uploads, read by yt-dlp from its "uploads" playlist -
 * the channel id with UC swapped for UU. That playlist is what the feed
 * mirrors: every upload, Shorts and streams included, newest first. A flat
 * listing carries no description or date, neither of which a scan needs.
 */
async function listUploads(channelId: string, settings: Settings): Promise<RssVideo[]> {
  const target = await resolveTarget(
    `https://www.youtube.com/playlist?list=UU${channelId.slice(2)}`,
    settings,
    null,
    UPLOADS_LIMIT
  );

  return target.entries.map((entry) => ({
    videoId: entry.videoId,
    title: entry.title ?? undefined,
    thumbnail: entry.thumbnail ?? undefined,
    link: entry.videoId ? `https://www.youtube.com/watch?v=${entry.videoId}` : entry.url
  }));
}

function extractYouTubeVideoId(entry: any): string | null {

  const id: string | undefined = entry?.id;

  if (id && id.includes("yt:video:")) {
    return id.split("yt:video:")[1] ?? null;
  }

  const link: string | undefined = entry?.link;

  if (link) {
    const m = link.match(/[?&]v=([^&]+)/);
    if (m?.[1]) return m[1];
  }

  return null;
}

function toVideo(entry: any): RssVideo {
  return {
    videoId: extractYouTubeVideoId(entry),
    title: entry?.title,
    description: entry?.mediaGroup?.['media:description']?.[0] ?? null,
    thumbnail: entry?.mediaGroup?.['media:thumbnail']?.[0]?.$.url ?? null,
    link: entry?.link,
    published: entry?.pubDate
  };
}

/**
 * The feed's entries, newest first.
 *
 * A scan reads more than the top entry when it is filtering Shorts out, and
 * one fetch answers for the whole feed either way — so the parse hands back
 * every entry and lets the caller decide how far down it cares to look.
 *
 * Falls back to listing the channel's uploads with yt-dlp when the feed will
 * not answer - see fetchFeedXml().
 */
export async function getFeedVideos(
  rssUrl: string,
  settings: Settings
): Promise<RssFeedResult> {
  try {
    const feed = await parser.parseString(await fetchFeedXml(rssUrl));

    return { videos: (feed.items ?? []).map(toVideo) };
  } catch (e: any) {
    const channelId = channelIdOf(rssUrl);

    if (!channelId) throw e;

    console.warn(`RSS unavailable for ${channelId} (${e?.message ?? e}), listing uploads with yt-dlp`);

    return { videos: await listUploads(channelId, settings) };
  }
}

export async function getFeedInfo(rssUrl: string) {
  const feed = await parser.parseString(await fetchFeedXml(rssUrl));
  return {
    channelName: feed.name,
    title: feed.title,
    image: feed.image?.url ?? null
  };
}
