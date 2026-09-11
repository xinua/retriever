import fs from "node:fs";
import path from "node:path";

import { ImagesService } from "./images.service.js";
import { YoutubeService } from "./youtube.service.js";
import { resolveTarget, MAX_ITEMS } from "./resolve.js";
import * as DownloadQueue from "./download-queue.js";

import type { Download, Settings } from "../db/types.js";
import type { ResolvedEntry } from "./resolve.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const IMAGES_DIR = process.env.IMAGES_DIR ?? path.join(DATA_DIR, "images");

// Artwork is cosmetic, so fetch it politely rather than firing hundreds of
// requests at YouTube the moment a channel is expanded.
const ARTWORK_CONCURRENCY = 4;

export type ManualDownloadRequest = {
  url: string;
  options: DownloadQueue.ManualOptions;
};

export type ManualDownloadResult = {
  kind: "video" | "playlist" | "channel";
  playlistId: string | null;
  playlistTitle: string | null;
  queued: number;
  truncated: boolean;
  limit: number;
  downloads: Download[];
};

/**
 * The whole manual-download flow: turn the pasted URL into videos, queue one
 * job per video, and pull the artwork the Downloads list expects.
 */
export async function startManualDownload(
  req: ManualDownloadRequest,
  settings: Settings
): Promise<ManualDownloadResult> {
  const target = await resolveTarget(req.url, settings);

  if (!target.entries.length) {
    throw new Error("No downloadable videos found at that URL");
  }

  const downloads = await DownloadQueue.enqueueManual(
    target.entries,
    req.options,
    { id: target.playlistId, title: target.playlistTitle }
  );

  // Artwork must not hold up the response — the rows are already queued and
  // yt-dlp is already working on the first of them.
  void cacheArtwork(target.entries, downloads).catch((e) =>
    console.warn("Manual download artwork failed:", e)
  );

  return {
    kind: target.kind,
    playlistId: target.playlistId,
    playlistTitle: target.playlistTitle,
    queued: downloads.length,
    truncated: target.truncated,
    limit: MAX_ITEMS,
    downloads
  };
}

function hasImage(filename: string): boolean {
  try {
    return fs.existsSync(path.join(IMAGES_DIR, filename));
  } catch {
    return false;
  }
}

/**
 * The Downloads list reads `/images/video-<id>.jpg` and
 * `/images/channel-<id>.jpg`, which the RSS worker only ever writes for
 * watched channels. Fill in the same files for manual downloads so their
 * cards look like every other one.
 *
 * `rows` are the downloads these entries were queued as, so each picture that
 * lands can be announced to the tabs already showing them. Nothing else will:
 * a row's own broadcasts stop when its download finishes, which for a short
 * video is well before artwork fetched over here arrives.
 *
 * The two fetches run alongside each other rather than one after the other.
 * A channel expansion is hundreds of thumbnails and a single avatar, and
 * queueing the avatar behind all of them is what left finished cards showing
 * the "not found" stand-in for minutes.
 */
async function cacheArtwork(
  entries: ResolvedEntry[],
  rows: Download[]
): Promise<void> {
  await Promise.all([cacheThumbnails(entries, rows), cacheAvatars(entries, rows)]);
}

async function cacheThumbnails(
  entries: ResolvedEntry[],
  rows: Download[]
): Promise<void> {
  /** Video ids this run wrote a thumbnail for. */
  const fetched = new Set<string>();

  const thumbnails = entries
    .filter((entry) => entry.videoId && entry.thumbnail)
    .filter((entry) => !hasImage(`video-${entry.videoId}.jpg`))
    .map((entry) => async () => {
      const filename = `video-${entry.videoId}.jpg`;

      if (await ImagesService.download(entry.thumbnail!, filename)) {
        fetched.add(entry.videoId!);
        return;
      }

      // yt-dlp lists maxresdefault for every video, but older or low-quality
      // uploads never had one and it 404s. hqdefault always exists — though
      // only on YouTube, where the id means something to i.ytimg.com. Every
      // other site keeps whatever thumbnail the extractor gave us.
      if (entry.platform !== "youtube") return;

      const landed = await ImagesService.download(
        `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
        filename
      );

      if (landed) fetched.add(entry.videoId!);
    });

  await runLimited(thumbnails, ARTWORK_CONCURRENCY);

  await DownloadQueue.republish(
    rows.filter((row) => row.videoId && fetched.has(row.videoId)).map((row) => row.id)
  );
}

async function cacheAvatars(
  entries: ResolvedEntry[],
  rows: Download[]
): Promise<void> {
  /** Channel ids this run wrote an avatar for. */
  const fetched = new Set<string>();

  // A playlist is usually one channel, so dedupe before hitting YouTube.
  // Only YouTube entries qualify: the lookup below builds a youtube.com
  // /channel/<id> URL, so a TikTok or Instagram uploader id would send it
  // somewhere that cannot exist. Those platforms just get no avatar.
  const channelIds = [
    ...new Set(
      entries
        .filter((entry) => entry.platform === "youtube")
        .map((entry) => entry.channelId)
        .filter(Boolean)
    )
  ].filter((id) => !hasImage(`channel-${id}.jpg`)) as string[];

  const avatars = channelIds.map((channelId) => async () => {
    const info = await YoutubeService.getChannelInfo(
      `https://www.youtube.com/channel/${channelId}`
    );

    if (!info?.avatar) return;

    if (await ImagesService.download(info.avatar, `channel-${channelId}.jpg`)) {
      fetched.add(channelId);
    }
  });

  await runLimited(avatars, ARTWORK_CONCURRENCY);

  await DownloadQueue.republish(
    rows.filter((row) => row.channelId && fetched.has(row.channelId)).map((row) => row.id)
  );
}

/** Runs tasks with a fixed number in flight, ignoring individual failures. */
async function runLimited(
  tasks: Array<() => Promise<void>>,
  limit: number
): Promise<void> {
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];

      try {
        await task();
      } catch {
        // artwork is best effort
      }
    }
  });

  await Promise.all(workers);
}
