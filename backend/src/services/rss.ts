import Parser from "rss-parser";
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
  etag?: string | null
  notModified?: boolean
};

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
 */
export async function getFeedVideos(
  rssUrl: string,
  prevEtag?: string | null
): Promise<RssFeedResult> {

  const headers: Record<string,string> = {};

  if (prevEtag) {
    headers["If-None-Match"] = prevEtag;
  }

  const res = await fetch(rssUrl, { headers });

  if (res.status === 304) {
    return {
      videos: [],
      notModified: true,
      etag: prevEtag ?? null
    };
  }

  if (!res.ok) {
    throw new Error(`RSS fetch failed: ${res.status}`);
  }

  const xml = await res.text();

  const feed = await parser.parseString(xml);

  return {
    videos: (feed.items ?? []).map(toVideo),
    etag: res.headers.get("etag")
  };
}

export async function getFeedInfo(rssUrl: string) {
  const feed = await parser.parseURL(rssUrl);
  return {
    channelName: feed.name,
    title: feed.title,
    image: feed.image?.url ?? null
  };
}
