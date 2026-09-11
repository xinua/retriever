import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Channel, Settings } from "../db/types.js";
import * as Ffmpeg from "./ffmpeg.js";

const execFileAsync = promisify(execFile);

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const BUNDLED_BIN = process.env.YTDLP_BIN ?? "/usr/local/bin/yt-dlp";
const MANAGED_BIN = path.join(DATA_DIR, "bin", "yt-dlp");
/**
 * One archive per watcher, rather than one for the whole app. A shared file
 * is keyed by video id alone, so a second subscription to a channel already
 * being watched — the same feed grabbed as audio as well as video, say —
 * found every video "already recorded" and yt-dlp skipped it silently, exit
 * code 0 and no file. Per-watcher files keep each subscription's history to
 * itself, and let removeArchive() forget a watcher along with its row.
 */
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");

export function archiveFile(watcherId: number): string {
  return path.join(ARCHIVE_DIR, `watcher-${watcherId}.txt`);
}

/** Called when a watcher is deleted, so re-adding it starts from nothing. */
export async function removeArchive(watcherId: number): Promise<void> {
  await fsp.rm(archiveFile(watcherId), { force: true }).catch(() => {});
}

const TEMP_DIR_NAME = ".retriever-tmp";

/**
 * Where the bundled bgutil POT provider plugin lives, and the provider server
 * to point it at. Both are opt-in — see potArgs().
 */
const POT_PLUGIN_DIR = process.env.POT_PLUGIN_DIR ?? "/app/pot-plugin";
const POT_BASE_URL = process.env.POT_BASE_URL?.trim();

/**
 * How many HLS/DASH fragments to pull at once. The native downloader fetches
 * them strictly one at a time, so on a host that throttles each connection
 * (most CDNs serving on-the-fly transmuxed HLS) the whole download runs at
 * single-stream speed no matter how much bandwidth is free. A plain mp4 is
 * one continuous request and is unaffected by this. Overridable per job,
 * since the user's extra args are appended after ours.
 */
const FRAGMENT_CONCURRENCY = "8";

export const DEFAULT_DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? "/downloads";

// Sentinels let us pick our own structured lines out of yt-dlp's stdout.
export const PROGRESS_PREFIX = "@@P@@";
export const FILE_PREFIX = "@@F@@";
export const DURATION_PREFIX = "@@D@@";

// No speed or eta: yt-dlp measures both inside the transfer currently in
// flight, which is wrong for anything fragmented. The queue derives them from
// the byte counts instead — see trackRate() in download-queue.ts.
const PROGRESS_TEMPLATE =
  `download:${PROGRESS_PREFIX}%(progress.status)s` +
  `|%(progress.downloaded_bytes)s` +
  `|%(progress.total_bytes)s` +
  `|%(progress.total_bytes_estimate)s`;

let resolvedBin: string | null = null;

/**
 * `yt-dlp -U` rewrites the binary in place, which would be thrown away every
 * time the container is recreated. So we run from a copy under DATA_DIR (a
 * volume) and refresh it whenever the image ships a newer one.
 */
export function resolveBin(): string {
  if (resolvedBin) return resolvedBin;

  const bundled = fs.existsSync(BUNDLED_BIN) ? fs.statSync(BUNDLED_BIN) : null;
  const managed = fs.existsSync(MANAGED_BIN) ? fs.statSync(MANAGED_BIN) : null;

  if (bundled && (!managed || bundled.mtimeMs > managed.mtimeMs)) {
    try {
      fs.mkdirSync(path.dirname(MANAGED_BIN), { recursive: true });
      fs.copyFileSync(BUNDLED_BIN, MANAGED_BIN);
      fs.chmodSync(MANAGED_BIN, 0o755);
      // copyFileSync stamps the copy with the current time, which would leave
      // it permanently "newer" than the image's binary and stop this branch
      // from ever running again — the staged yt-dlp would then be frozen at
      // whatever version first landed here, however many images were pulled
      // afterwards. Carrying the source mtime across keeps the comparison
      // above meaningful, while a self-update via `-U` still wins because it
      // bumps the managed mtime past the image's.
      fs.utimesSync(MANAGED_BIN, bundled.atime, bundled.mtime);
    } catch (e) {
      console.warn("yt-dlp: could not stage managed binary, using bundled:", e);
      resolvedBin = BUNDLED_BIN;
      return resolvedBin;
    }
  }

  if (fs.existsSync(MANAGED_BIN)) {
    resolvedBin = MANAGED_BIN;
  } else if (bundled) {
    resolvedBin = BUNDLED_BIN;
  } else {
    // Fall back to PATH so a dev machine with yt-dlp installed just works.
    resolvedBin = "yt-dlp";
  }

  return resolvedBin;
}

/**
 * The version, remembered per binary. yt-dlp is a one-file PyInstaller
 * bundle, so `--version` unpacks a Python runtime and boots an interpreter
 * every time — a noticeable chunk of CPU on a NAS — for an answer that only
 * changes when the file on disk does. The cache is keyed on the binary's path
 * and mtime, so a `-U` (which rewrites the file) or a newer image (which
 * restages it) is picked up without anyone having to clear it. Failures are
 * not cached, so a binary that turns up later is noticed on the next call.
 */
let versionCache: { bin: string; mtimeMs: number; version: string } | null =
  null;

export async function getVersion(): Promise<string | null> {
  const bin = resolveBin();
  const mtimeMs = binaryMtime(bin);

  if (
    versionCache &&
    versionCache.bin === bin &&
    versionCache.mtimeMs === mtimeMs
  ) {
    return versionCache.version;
  }

  try {
    const { stdout } = await execFileAsync(bin, ["--version"], {
      timeout: 15000
    });

    const version = stdout.trim() || null;

    versionCache = version ? { bin, mtimeMs, version } : null;

    return version;
  } catch {
    versionCache = null;
    return null;
  }
}

/**
 * A bare "yt-dlp" resolved from PATH cannot be stat'ed by name; -1 stands in
 * so it still caches, and update() drops the cache by hand in that case.
 */
function binaryMtime(bin: string): number {
  try {
    return fs.statSync(bin).mtimeMs;
  } catch {
    return -1;
  }
}

export async function update(): Promise<{
  ok: boolean;
  from: string | null;
  to: string | null;
  output: string;
}> {
  const from = await getVersion();

  try {
    const { stdout, stderr } = await execFileAsync(resolveBin(), ["-U"], {
      timeout: 120000
    });

    resolvedBin = null;
    versionCache = null;
    const to = await getVersion();

    return { ok: true, from, to, output: `${stdout}${stderr}`.trim() };
  } catch (e: any) {
    return {
      ok: false,
      from,
      to: from,
      output: `${e?.stdout ?? ""}${e?.stderr ?? e?.message ?? ""}`.trim()
    };
  }
}

/**
 * User-supplied folder/prefix values end up in a real filesystem path once we
 * spawn yt-dlp locally, so they must not be able to escape the download root.
 *
 * This handles one path segment: separators are collapsed to "_" because a
 * filename cannot contain them. A prefix keeps its trailing spaces (people
 * write "Channel - "), a folder segment does not.
 */
export function sanitizeSegment(
  value: string | null | undefined,
  opts: { keepTrailingSpace?: boolean } = {}
): string {
  if (!value) return "";

  const cleaned = value
    .replace(/[\\/]+/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[.\s]+/, "");

  return opts.keepTrailingSpace ? cleaned : cleaned.replace(/\s+$/, "");
}

/**
 * The per-channel folder may be nested ("podcasts/tech"), so slashes are kept
 * as separators. Each segment is sanitized on its own, and "." / ".." segments
 * are dropped outright so the result can never climb out of the download root.
 */
export function sanitizeFolder(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => sanitizeSegment(segment))
    .filter(Boolean)
    .join(path.sep);
}

/**
 * Splits an extra-args string the way a shell would, honouring quotes so
 * values like --extractor-args "youtube:player_client=web" stay intact.
 */
export function tokenizeArgs(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];

  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }

  return tokens;
}

/**
 * Flags that route YouTube extraction through a bgutil POT provider server,
 * which mints the proof-of-origin tokens YouTube increasingly demands before
 * it will hand over media URLs.
 *
 * The provider is opt-in, and deliberately opt-in twice over: with
 * POT_BASE_URL unset the plugin is not even placed on yt-dlp's plugin search
 * path, so a stock single-container install runs exactly the command line it
 * ran before. Shipping the plugin somewhere yt-dlp finds on its own would make
 * it probe its built-in 127.0.0.1:4416 default and warn on every job that
 * wants a token, which is noise for the majority who run no provider at all.
 *
 * These go in ahead of the user's own arguments, so a later --extractor-args
 * of theirs still wins.
 */
export function potArgs(): string[] {
  if (!POT_BASE_URL) return [];

  return [
    "--plugin-dirs",
    POT_PLUGIN_DIR,
    "--extractor-args",
    `youtubepot-bgutilhttp:base_url=${POT_BASE_URL}`
  ];
}

/**
 * yt-dlp needs a JavaScript runtime to solve YouTube's signature and `n`
 * challenges. Only deno is enabled by default, and without any runtime
 * extraction is deprecated upstream and quietly loses formats — the symptom
 * is a download that succeeds at a worse quality than the site offers, or a
 * "Only images are available" failure on clients that always sign.
 *
 * The app itself runs under node, so process.execPath is a node binary that
 * is guaranteed to exist and needs no PATH lookup — which also holds in the
 * container, where node is the base image.
 */
export function jsRuntimeArgs(): string[] {
  return ["--js-runtimes", `node:${process.execPath}`];
}

/** What the settings dialog shows about the configured POT provider. */
export type PotStatus = {
  configured: boolean;
  baseUrl: string | null;
  ok: boolean;
  version: string | null;
  error: string | null;
};

const POT_PING_TIMEOUT_MS = 3000;

/**
 * Ping the provider server. A dead provider is otherwise invisible: yt-dlp
 * carries on without a token and the damage surfaces later as bot checks on
 * individual downloads, so it is worth stating plainly in the UI.
 */
export async function potStatus(): Promise<PotStatus> {
  if (!POT_BASE_URL) {
    return {
      configured: false,
      baseUrl: null,
      ok: false,
      version: null,
      error: null
    };
  }

  const base = { configured: true, baseUrl: POT_BASE_URL };

  try {
    const response = await fetch(`${POT_BASE_URL.replace(/\/+$/, "")}/ping`, {
      signal: AbortSignal.timeout(POT_PING_TIMEOUT_MS)
    });

    if (!response.ok) {
      return {
        ...base,
        ok: false,
        version: null,
        error: `Provider answered ${response.status}`
      };
    }

    const body = (await response.json()) as { version?: string };

    return { ...base, ok: true, version: body?.version ?? null, error: null };
  } catch (e: any) {
    return {
      ...base,
      ok: false,
      version: null,
      error:
        e?.name === "TimeoutError"
          ? "Provider did not answer in time"
          : "Provider unreachable"
    };
  }
}

/**
 * Everything `buildArgs` needs to describe one download, decoupled from where
 * it came from. Watcher downloads derive this from their channel row, manual
 * ones from the download row's own snapshot.
 */
export type JobOptions = {
  type: string;
  format: string;
  codec: string | null;
  quality: string | null;
  /** Sub-directory of the downloads root; the channel's `tag` for watchers. */
  folder: string | null;
  prefix: string | null;
  ytdlpArgs: string | null;
  clipStart: string | null;
  clipEnd: string | null;
  removeSponsor: boolean;
  splitChapters: boolean;
  /**
   * The watcher whose archive this job records itself in, so a channel is
   * never scraped twice. Null skips the archive entirely: manual downloads
   * and manual retries were asked for by name, and "already downloaded" must
   * not silently turn that into a no-op.
   */
  archiveWatcherId: number | null;
  /**
   * Audio jobs only: keep the file the audio was extracted from instead of
   * letting yt-dlp delete it. Set for a download with no artwork anywhere, so
   * a poster can be taken out of the video the way a video download's is —
   * see needsPosterSource() in download-queue.ts. Costs the video's disk space
   * until the capture is done, and nothing at all when the source was
   * audio-only to begin with.
   */
  keepVideo?: boolean;
};

export function optionsFromChannel(ch: Channel): JobOptions {
  return {
    type: ch.type,
    format: ch.format,
    codec: ch.codec,
    quality: null,
    folder: ch.tag,
    prefix: ch.prefix,
    ytdlpArgs: ch.ytdlpArgs,
    clipStart: null,
    clipEnd: null,
    removeSponsor: false,
    splitChapters: false,
    archiveWatcherId: ch.id
  };
}

/**
 * Sites do not agree on how to spell a codec: YouTube reports "avc1"/"hev1",
 * TikTok reports plain "h264"/"h265". Matching only YouTube's spelling made an
 * explicit codec choice fail outright elsewhere — "Requested format is not
 * available" — so each of these accepts both conventions.
 */
const VCODEC_FILTERS: Record<string, string> = {
  h264: "[vcodec~='^(avc|h264)']",
  h265: "[vcodec~='^(hev|hvc|h265)']",
  av1: "[vcodec~='^(av01|av1)']",
  vp9: "[vcodec~='^(vp0?9)']"
};

/**
 * What "auto" rules out, rather than what it prefers. Browsers play VP9 and
 * AV1 perfectly well, so there is no reason to force H.264 and give up their
 * efficiency — HEVC is the one codec Chrome and Firefox will not decode.
 * yt-dlp ranks it above H.264 though, so on a site offering both at the same
 * resolution (TikTok does) the HEVC variant wins by default and the in-page
 * player ends up showing controls over a blank frame.
 *
 * It is only a preference: the selector chain still falls through to an
 * unfiltered tier, so a video available *only* in HEVC is downloaded anyway.
 */
const NO_HEVC = "[vcodec!~='^(hev|hvc|h265)']";

const AUDIO_FORMATS = new Set(["m4a", "mp3", "opus", "wav", "flac"]);

/**
 * A bitrate target means nothing to a lossless codec — ffmpeg accepts -b:a
 * there and ignores it — so these formats are always encoded at best effort.
 */
const LOSSLESS_AUDIO = new Set(["wav", "flac"]);

/**
 * Audio has no height to cap, so its quality is a target bitrate applied by
 * ffmpeg during the extraction. The "K" is kept because yt-dlp reads a bare
 * number of 10 or less as a VBR level instead of a bitrate.
 */
const AUDIO_BITRATES: Record<string, string> = {
  "320kbps": "320K",
  "192kbps": "192K",
  "128kbps": "128K"
};

/**
 * A quality is a ceiling, not an exact match: "1080p" means the best stream
 * at 1080p or below, so a video that only exists in 720p still downloads.
 */
const QUALITY_HEIGHTS: Record<string, number> = {
  "2160p": 2160,
  "1440p": 1440,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
  "360p": 360,
  "240p": 240
};

function buildFormatArgs(opts: JobOptions): string[] {
  if (opts.type === "thumbnail") {
    return [
      "--skip-download",
      "--write-thumbnail",
      "--convert-thumbnails", "jpg"
    ];
  }

  if (opts.type === "audio") {
    const audioFormat = AUDIO_FORMATS.has(opts.format) ? opts.format : "m4a";

    // Rows queued before audio had its own quality list carry a video value:
    // "worst" still means what it did, and a height is simply not a bitrate.
    const worst = opts.quality === "worst";
    const bitrate = LOSSLESS_AUDIO.has(audioFormat)
      ? undefined
      : AUDIO_BITRATES[opts.quality ?? ""];

    return [
      // A bitrate is a transcode target, not a stream choice — the best
      // source is still the one to start from, so only "worst" changes -f.
      "-f", worst ? "wa/w" : "ba/b",
      "-x",
      "--audio-format", audioFormat,
      "--audio-quality", worst ? "9" : (bitrate ?? "0")
    ];
  }

  // An explicit choice is honoured as-is; "auto" only avoids HEVC.
  const explicit = VCODEC_FILTERS[opts.codec ?? "auto"];
  const preferred = explicit ?? NO_HEVC;
  const codec = explicit ?? "";

  const isMp4 = opts.format === "mp4" || opts.format === "ios";

  if (opts.quality === "worst") {
    // A codec filter would fight the "smallest possible" intent, so drop it.
    return isMp4
      ? [
          "-f", "wv*[ext=mp4]+wa[ext=m4a]/wv*+wa/w[ext=mp4]/w",
          "--merge-output-format", "mp4"
        ]
      : ["-f", "wv*+wa/w"];
  }

  const height = QUALITY_HEIGHTS[opts.quality ?? ""];
  const cap = height ? `[height<=${height}]` : "";
  const filter = `${codec}${cap}`;
  const wanted = `${preferred}${cap}`;

  // iOS uses the same mp4-friendly selector; the client switch happens below.
  // The preferred tiers come first and the plain ones behind them, so the
  // codec preference never costs a download that could otherwise happen.
  const selectors = isMp4
    ? [
        `bv*${wanted}[ext=mp4]+ba[ext=m4a]`,
        `bv*${wanted}+ba`,
        `bv*${filter}[ext=mp4]+ba[ext=m4a]`,
        `bv*${filter}+ba`,
        `b${wanted}[ext=mp4]`,
        `b${cap}[ext=mp4]`,
        `b${cap}`
      ]
    : [`bv*${wanted}+ba`, `bv*${filter}+ba`, `b${wanted}`, `b${cap}`];

  // Last resort when the height cap matches nothing — a vertical TikTok is
  // 1024 tall, so "720p or below" excludes every format it has. Drop the cap
  // rather than fail, but keep the codec preference one tier longer: going
  // straight to a bare "b" here was enough to hand back the HEVC copy the
  // preference exists to avoid.
  if (cap) selectors.push(`b${preferred}`, "b");

  // An explicit codec makes the preferred and plain tiers identical.
  const chain = [...new Set(selectors)].join("/");

  return isMp4
    ? ["-f", chain, "--merge-output-format", "mp4"]
    : ["-f", chain];
}

/**
 * `--download-sections` wants a single range. Either end may be missing:
 * yt-dlp accepts "inf" as an open end, and 0 as an open start.
 */
function buildSectionArg(opts: JobOptions): string | null {
  const start = opts.clipStart?.trim();
  const end = opts.clipEnd?.trim();

  if (!start && !end) return null;

  // Cutting a container we never decoded is not possible.
  if (opts.type === "thumbnail") return null;

  return `*${start || "0"}-${end || "inf"}`;
}

export function downloadsRoot(settings: Settings): string {
  return path.resolve(settings.downloadsDir?.trim() || DEFAULT_DOWNLOADS_DIR);
}

/** Absolute directory a job's finished files are moved into. */
export function buildHomeDir(opts: JobOptions, settings: Settings): string {
  const root = downloadsRoot(settings);
  const dir = path.resolve(root, sanitizeFolder(opts.folder));

  // Belt and braces: sanitizeFolder already drops "..", but never let a
  // crafted folder value write outside the download root.
  return dir === root || dir.startsWith(root + path.sep) ? dir : root;
}

/**
 * Names promised to jobs that are running but have not written anything yet.
 *
 * The directory is read to decide the next free number, and a download takes
 * minutes to produce the file that would make the answer different. Two jobs
 * writing the same name into the same folder at once would therefore both
 * read a directory without it and both pick the same name. Keyed by job id so
 * the queue can drop the claim from `release`, alongside the rest of a job's
 * in-memory state.
 */
const claimedNames = new Map<
  number,
  { dir: string; stem: string; index: number }
>();

/** Drops a running job's claim on its filename. */
export function releaseFilename(jobId: number): void {
  claimedNames.delete(jobId);
}

/**
 * yt-dlp's own filename sanitiser, as it runs on Linux with default options:
 * every `%(field)s` value goes through it before it reaches the path, while
 * literal text in the template does not.
 *
 * The point is to know the name on disk before the download writes it, so a
 * copy already sitting in the folder can be spotted and numbered around. It
 * is a port rather than a guess — `sanitize_filename(s, restricted=False)`
 * with the id exemption unset, which is the only path taken unless the extra
 * arguments ask for `--restrict-filenames` or `--windows-filenames`.
 *
 * Only these characters move: the ones a Windows path cannot hold become
 * their full-width look-alikes, and control characters are dropped. Colons
 * inside timestamps ("12:34:56") turn into underscores first, before the
 * full-width rule would have claimed them.
 */
export function sanitizeTitle(title: string): string {
  if (!title) return "";

  const FULL_WIDTH: Record<string, string> = { "/": "\u29F8", "\\": "\u29F9" };

  const replaced = title
    .replace(/[0-9]+(?::[0-9]+)+/g, (stamp) => stamp.replace(/:/g, "_"))
    .replace(/[\s\S]/g, (char) => {
      // A newline is substituted rather than dropped, so the collapsing below
      // can tell it apart from a space that was always there. \0 marks it.
      if (char === "\n") return "\0 ";

      if ('"*:<>?|/\\'.includes(char)) {
        return (
          FULL_WIDTH[char] ?? String.fromCharCode(char.charCodeAt(0) + 0xfee0)
        );
      }

      const code = char.charCodeAt(0);

      return code < 32 || code === 127 ? "" : char;
    });

  const collapsed = replaced
    .replace(/(\0[\s\S])(?:\1)+/g, "$1")
    .replace(/^\0[\s\S](?:\0[\s\S]|[ _-])*|(?:\0[\s\S]|[ _-])*\0[\s\S]$/g, "");

  return collapsed.replace(/\0/g, "") || "_";
}

/** `name` without its extension, which is what a copy number sits before. */
function stemOf(name: string): string {
  return name.slice(0, name.length - path.extname(name).length);
}

/**
 * The next free copy number for this name in this folder: 0 when nothing of
 * it is there, 1 when the plain name is taken, and so on.
 *
 * Sidecars count as much as the media does — a thumbnail job writes only a
 * `.jpg`, and a second one asking for the same picture should still land next
 * to the first rather than on top of it. Split chapters and format fragments
 * carry their own suffix inside the stem, so they never match and never
 * consume a number of their own.
 */
async function nextCopyIndex(
  dir: string,
  stem: string,
  jobId: number
): Promise<number> {
  const used = new Set<number>();

  for (const [id, claim] of claimedNames) {
    if (id !== jobId && claim.dir === dir && claim.stem === stem) {
      used.add(claim.index);
    }
  }

  let names: string[] = [];

  try {
    names = await fsp.readdir(dir);
  } catch {
    // Not created until the first download lands in it, so nothing is taken.
  }

  for (const name of names) {
    const base = stemOf(name);

    if (base === stem) {
      used.add(0);
      continue;
    }

    if (!base.startsWith(stem)) continue;

    const numbered = /^ \((\d+)\)$/.exec(base.slice(stem.length));

    if (numbered) used.add(Number(numbered[1]));
  }

  let index = 0;

  while (used.has(index)) index += 1;

  return index;
}

/**
 * Filename only — the directory comes from `-P home:`.
 *
 * The name is the video's title, and nothing else: no id, no uploader, no
 * date. Titles are not unique, though — Instagram auto-generates "Video by
 * <author>" for any post without a caption, so every silent post by one
 * author asks for the same path — and neither of yt-dlp's own answers to a
 * name already on disk keeps both files. It skips the download and reports
 * the file that was already there, so the new row points at the old file and
 * whatever was asked for the second time (a different quality, a clip, a
 * chapter split) never happens; with `--force-overwrites` it writes over the
 * earlier copy instead. Numbering the new one keeps both, the way a browser's
 * download folder does.
 *
 * Deciding that needs the name before yt-dlp writes it, which is why the
 * title is sanitised here as well: `sanitizeTitle` is yt-dlp's own rule, so
 * the stem this compares against the folder is the stem it will produce.
 *
 * A custom `-o` in the extra arguments overrides this template wholesale, and
 * with it the numbering — yt-dlp's own behaviour applies from there.
 */
export async function buildFilenameTemplate(
  opts: JobOptions,
  settings: Settings,
  title: string | null,
  jobId: number
): Promise<string> {
  const prefix = sanitizeSegment(opts.prefix, { keepTrailingSpace: true });
  const template = `${prefix}%(title)s`;

  // Nothing to search a directory for: the title yt-dlp will use is not known
  // here, so let it write whatever it writes. Rare, and the worst case is
  // only what this did before numbering existed.
  if (!title?.trim()) return `${template}.%(ext)s`;

  const dir = buildHomeDir(opts, settings);
  const stem = `${prefix}${sanitizeTitle(title)}`;
  const index = await nextCopyIndex(dir, stem, jobId);

  claimedNames.set(jobId, { dir, stem, index });

  return index ? `${template} (${index}).%(ext)s` : `${template}.%(ext)s`;
}

/**
 * The names already in a job's destination folder, for telling what the job
 * itself wrote from what was there before it started. Empty when the folder
 * does not exist yet, which says the same thing.
 */
export async function listHome(
  opts: JobOptions,
  settings: Settings
): Promise<Set<string>> {
  try {
    return new Set(await fsp.readdir(buildHomeDir(opts, settings)));
  } catch {
    return new Set();
  }
}

/**
 * Per-download scratch space for `.part` and fragment files. It lives under
 * the downloads root so the finished file is a rename rather than a copy, and
 * is dot-prefixed so media scanners skip it. Deleting this directory is the
 * whole of cleanup — no filename guessing.
 */
export function buildTempDir(settings: Settings, jobId: number): string {
  return path.join(downloadsRoot(settings), TEMP_DIR_NAME, String(jobId));
}

export function cleanupTemp(settings: Settings, jobId: number): void {
  try {
    fs.rmSync(buildTempDir(settings, jobId), {
      recursive: true,
      force: true,
      maxRetries: 2
    });
  } catch {
    // best effort only
  }
}

/**
 * Work in progress rather than a result: a partial transfer, yt-dlp's resume
 * state, or one half of a merge that never happened. None of it is a file the
 * user asked for, and all of it is worth keeping so a retry can resume.
 */
const PARTIAL_FILE = /\.(part|ytdl|temp|ytdlp)$|\.part-Frag\d+$|\.f\d+\.[^.]+$/i;

/**
 * Rescues a finished file out of the scratch directory after a failed job.
 *
 * yt-dlp downloads into `temp:` and only moves the result to `home:` once
 * every postprocessor has run, so a job that downloads perfectly well and
 * then trips over a broken ffmpeg leaves a complete, playable file sitting in
 * the scratch space. Deleting that directory — which is what cleanup does on
 * every other outcome — threw the file away, which is why a failure here
 * looked so much worse than the same failure run by hand in a terminal: there
 * the file is simply left in the working directory.
 *
 * The filename template is the same for both paths, so the basename is
 * already the name the file would have had. Everything still in flight is
 * left where it is for a retry to resume from.
 */
export async function rescueTemp(
  opts: JobOptions,
  settings: Settings,
  jobId: number
): Promise<string | null> {
  const temp = buildTempDir(settings, jobId);

  let names: string[];

  try {
    names = await fsp.readdir(temp);
  } catch {
    return null;
  }

  const finished = names.filter((name) => !PARTIAL_FILE.test(name));

  if (!finished.length) return null;

  const home = buildHomeDir(opts, settings);

  await fsp.mkdir(home, { recursive: true });

  let best: { path: string; size: number } | null = null;

  for (const name of finished) {
    const from = path.join(temp, name);
    const to = path.join(home, name);

    try {
      const stat = await fsp.stat(from);

      if (!stat.isFile() || stat.size === 0) continue;

      // Same filesystem by design — the scratch dir lives under the download
      // root — so this is a rename, but fall back for an exotic mount.
      try {
        await fsp.rename(from, to);
      } catch {
        await fsp.copyFile(from, to);
        await fsp.rm(from, { force: true });
      }

      // A merge that failed halfway can leave more than one; the largest is
      // the one worth pointing the row at.
      if (!best || stat.size > best.size) best = { path: to, size: stat.size };
    } catch {
      // Skip anything that cannot be moved and keep the rest.
    }
  }

  // Whatever is left is either something to resume from or yt-dlp's own
  // resume bookkeeping, which is worthless on its own — so the directory only
  // survives if it still holds real bytes.
  try {
    const left = await fsp.readdir(temp);

    if (left.every((name) => name.toLowerCase().endsWith(".ytdl"))) {
      await fsp.rm(temp, { recursive: true, force: true, maxRetries: 2 });
    }
  } catch {
    // best effort only
  }

  return best?.path ?? null;
}

/**
 * Drops scratch directories that no live job owns.
 *
 * Failed jobs now keep theirs so a retry resumes instead of starting the
 * download again from zero, which means something has to collect the ones
 * whose row was deleted or has long since been dealt with. Run at boot, when
 * nothing is running yet and every surviving directory is by definition
 * abandoned unless its download is still queued.
 */
export async function sweepTemp(
  settings: Settings,
  keepIds: Iterable<number>
): Promise<number> {
  const root = path.join(downloadsRoot(settings), TEMP_DIR_NAME);
  const keep = new Set(Array.from(keepIds, String));

  let names: string[];

  try {
    names = await fsp.readdir(root);
  } catch {
    return 0;
  }

  let removed = 0;

  for (const name of names) {
    if (keep.has(name)) continue;

    try {
      await fsp.rm(path.join(root, name), {
        recursive: true,
        force: true,
        maxRetries: 2
      });

      removed += 1;
    } catch {
      // best effort only
    }
  }

  return removed;
}

export async function buildArgs(
  opts: JobOptions,
  settings: Settings,
  videoUrl: string,
  jobId: number,
  /**
   * The video's title, used to work out the name it will be saved under and
   * so to spot copies of it already in the destination folder. Null when the
   * resolve could not name one.
   */
  title: string | null,
  /**
   * A cached info dict from the resolve step. When present the page is not
   * extracted again — yt-dlp works straight from these formats, which is both
   * faster and immune to the extractor failing on a site that is having a bad
   * day. The file replaces the URL argument rather than accompanying it.
   */
  infoJsonPath?: string | null
): Promise<string[]> {
  const args: string[] = [
    // Playlists and channels are expanded into one job per video before they
    // reach here, so a job is always exactly one video.
    "--no-playlist",
    "--newline",
    "--no-color",
    // --print implies --quiet, which would swallow progress output.
    "--progress",
    "--progress-delta", "1",
    "--concurrent-fragments", FRAGMENT_CONCURRENCY,
    "--progress-template", PROGRESS_TEMPLATE,
    "--print", `video:${DURATION_PREFIX}%(duration)s`,
    "--print", `after_move:${FILE_PREFIX}%(filepath)s`,
    "--no-simulate",
    "-P", `home:${buildHomeDir(opts, settings)}`,
    "-P", `temp:${buildTempDir(settings, jobId)}`,
    "-o", await buildFilenameTemplate(opts, settings, title, jobId),
    ...buildFormatArgs(opts)
  ];

  // Pin the ffmpeg yt-dlp uses rather than letting it take the first one on
  // PATH, which is not necessarily one that works — see services/ffmpeg.ts.
  const ffmpeg = Ffmpeg.known();

  if (ffmpeg?.location) {
    args.push("--ffmpeg-location", ffmpeg.location);
  }

  if (opts.archiveWatcherId != null) {
    await fsp.mkdir(ARCHIVE_DIR, { recursive: true });
    args.push("--download-archive", archiveFile(opts.archiveWatcherId));
  }

  // Only meaningful next to -x, which is the only thing that would have
  // removed it.
  if (opts.keepVideo && opts.type === "audio") {
    args.push("--keep-video");
  }

  // Tag the file the way a player expects: title, artist (the uploader),
  // date (the upload year), comment (the source URL), description and genre,
  // all taken from the info dict yt-dlp already has. Without this a download
  // carries nothing but an encoder string, so a library shows it under its
  // filename with no artist at all. Chapters come along for free. The info
  // json is left out: yt-dlp would attach the whole dict to an mkv, formats
  // list and all, which nothing here reads back. Runs before the cover-art
  // step in download-queue.ts, whose remux copies these tags over. Thumbnail
  // jobs have no media to tag.
  if (opts.type !== "thumbnail") {
    args.push("--embed-metadata", "--no-embed-info-json");
  }

  // --skip-download never moves a file, so after_move cannot report the
  // thumbnail. %(filename)s is the media path yt-dlp would have written;
  // the queue swaps the extension for the converted .jpg.
  if (opts.type === "thumbnail") {
    args.push("--print", `video:${FILE_PREFIX}%(filename)s`);
  }

  const section = buildSectionArg(opts);

  if (section) {
    args.push("--download-sections", section);
  }

  if (opts.removeSponsor && opts.type !== "thumbnail") {
    args.push("--sponsorblock-remove", "default");
  }

  if (opts.splitChapters && opts.type !== "thumbnail") {
    args.push("--split-chapters");
  }

  if (opts.format === "ios" && opts.type === "video") {
    args.push("--extractor-args", "youtube:player_client=ios");
  }

  if (settings.cookiesPath?.trim()) {
    args.push("--cookies", settings.cookiesPath.trim());
  }

  args.push(...jsRuntimeArgs());
  args.push(...potArgs());

  // Per-job args come last so they override the global ones.
  args.push(...tokenizeArgs(settings.ytdlpArgs));
  args.push(...tokenizeArgs(opts.ytdlpArgs));

  if (infoJsonPath) {
    args.push("--load-info-json", infoJsonPath);
  } else {
    args.push("--", videoUrl);
  }

  return args;
}

/**
 * Filesystem calls on a user-supplied path can block indefinitely on odd
 * mounts (procfs, a dead network share). Everything here is async and time
 * limited so a bad Downloads folder cannot wedge the server.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), ms).unref()
    )
  ]);
}

const FS_CHECK_TIMEOUT_MS = 5000;

export async function checkHealth(settings: Settings): Promise<{
  ok: boolean;
  version: string | null;
  error?: string;
}> {
  const version = await getVersion();

  if (!version) {
    return { ok: false, version: null, error: "yt-dlp binary not available" };
  }

  const dir = settings.downloadsDir?.trim() || DEFAULT_DOWNLOADS_DIR;

  try {
    await withTimeout(
      fsp
        .mkdir(dir, { recursive: true })
        .then(() => fsp.access(dir, fs.constants.W_OK)),
      FS_CHECK_TIMEOUT_MS
    );
  } catch {
    return { ok: false, version, error: `Downloads dir not writable: ${dir}` };
  }

  const cookies = settings.cookiesPath?.trim();

  if (cookies) {
    try {
      await withTimeout(
        fsp.access(cookies, fs.constants.R_OK),
        FS_CHECK_TIMEOUT_MS
      );
    } catch {
      return {
        ok: false,
        version,
        error: `Cookies file not readable: ${cookies}`
      };
    }
  }

  // Reported rather than fatal: plenty of downloads are a single file that
  // never touches ffmpeg, so a broken one is a warning, not an outage. It is
  // worth saying out loud though — every symptom it causes turns up as an
  // unrelated-looking yt-dlp error on an individual download.
  const ffmpeg = await Ffmpeg.status();

  if (!ffmpeg.ok) {
    return { ok: true, version, error: ffmpeg.error };
  }

  return { ok: true, version };
}
