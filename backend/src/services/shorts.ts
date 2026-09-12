/**
 * Whether a video is a Short.
 *
 * The feed a subscription polls carries no marker for it — Shorts sit in the
 * same `videos.xml` as everything else, with the same entry shape, the same
 * thumbnail and no hint of their length — so the only authority on the
 * question is YouTube itself. `/shorts/<id>` answers 200 for a Short and
 * redirects to the watch page for anything else, and a HEAD is enough to see
 * which: the check costs one header exchange and never fetches a page.
 *
 * Asking yt-dlp instead would be more expensive than the download decision it
 * is feeding — a full extraction per feed entry, just to read a duration that
 * would still only be a guess at what YouTube counts as a Short.
 */

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Shortness never changes, so a verdict is worth keeping for the life of the
 * process: a Short at the top of a feed is re-examined on every poll until a
 * real video pushes it down, and only the first of those scans should pay for
 * a request. Bounded because a long-running instance watches an unbounded
 * number of videos; oldest out first, which is insertion order here.
 */
const verdicts = new Map<string, boolean>();
const MAX_VERDICTS = 500;

function remember(videoId: string, short: boolean): boolean {
  if (verdicts.size >= MAX_VERDICTS) {
    const oldest = verdicts.keys().next().value;

    if (oldest !== undefined) verdicts.delete(oldest);
  }

  verdicts.set(videoId, short);

  return short;
}

function isYouTubeLink(link: string): boolean {
  try {
    const { hostname } = new URL(link);

    return /(^|\.)(youtube\.com|youtu\.be)$/i.test(hostname);
  } catch {
    return false;
  }
}

export type ShortsCandidate = {
  videoId?: string | null;
  link?: string | null;
};

/**
 * True when `video` is a YouTube Short.
 *
 * Anything the probe cannot answer — a request that failed, a status that is
 * neither 200 nor a redirect, a feed that is not YouTube's — is reported as
 * not a Short, so a subscription whose network is having a bad minute still
 * captures its videos. The filter is a preference, and failing to grab a
 * video is the more expensive way to get it wrong than grabbing one Short.
 */
export async function isShort(video: ShortsCandidate): Promise<boolean> {
  const videoId = video.videoId?.trim();

  if (!videoId) return false;
  if (video.link && !isYouTubeLink(video.link)) return false;

  const known = verdicts.get(videoId);

  if (known !== undefined) return known;

  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });

    if (res.status === 200) return remember(videoId, true);

    // 303 to /watch?v=… is the shape of "not a Short". Anything else — a 404
    // for a video that has since gone, a block page — says nothing about the
    // question, so it is left unanswered rather than cached as a verdict.
    if (res.status >= 300 && res.status < 400) return remember(videoId, false);

    console.warn(`Shorts check for ${videoId}: unexpected status ${res.status}`);

    return false;
  } catch (e) {
    console.warn(`Shorts check for ${videoId} failed:`, e);

    return false;
  }
}
