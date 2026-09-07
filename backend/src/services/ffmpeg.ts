import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * yt-dlp shells out to ffmpeg and ffprobe for merging, remuxing, fixups and —
 * for some HLS formats — the download itself, and it finds them by walking
 * PATH. That makes the first ffmpeg on PATH a silent dependency of every
 * download, and a broken one fails in ways that look like anything but
 * "ffmpeg is broken":
 *
 *   ERROR: ffmpeg exited with code -11
 *   ERROR: Postprocessing:   libpostproc    58.  1.100 / 58.  1.100
 *   ERROR: Expecting value: line 1 column 1 (char 0)
 *
 * All three are one thing — ffmpeg (or ffprobe) died on a signal, so yt-dlp
 * reports the last line it managed to print, or fails to parse the JSON it
 * never got. The build that prompted this is a statically linked ffmpeg,
 * which segfaults the moment it resolves a hostname: static glibc has to
 * dlopen the host's NSS modules, and against a newer glibc than it was built
 * with, that jumps into nothing. Local files are fine, so it looks healthy
 * right up until a download needs it.
 *
 * So rather than trust PATH, probe the candidates and hand yt-dlp one that
 * survives the probe.
 */

/**
 * Not a real host: `.invalid` is reserved by RFC 2606 precisely so it can
 * never resolve. A healthy binary prints "Failed to resolve hostname" and
 * exits non-zero without touching the network; a broken one dies where the
 * resolver would have been.
 */
const PROBE_URL = "http://ffmpeg-probe.invalid/probe.mp4";

const PROBE_TIMEOUT_MS = 10000;

/** Searched after PATH, for the launcher that starts the server with a bare one. */
const EXTRA_DIRS = ["/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin", "/snap/bin"];

export type FfmpegStatus = {
  /** Directory to pass to `--ffmpeg-location`, or null to leave yt-dlp to PATH. */
  location: string | null;
  ok: boolean;
  /** Populated when nothing usable was found, for the health readout. */
  error?: string;
};

let cached: Promise<FfmpegStatus> | null = null;
let last: FfmpegStatus | null = null;

/** The probe result, running the probe once and sharing it. */
export function status(): Promise<FfmpegStatus> {
  cached ??= run();

  return cached;
}

/** Re-probes; call after the user installs or replaces a binary. */
export function refresh(): Promise<FfmpegStatus> {
  cached = null;
  return status();
}

/**
 * The last probe result without waiting for one. Null until the first probe
 * settles, which is why the server kicks it off at boot — `buildArgs` is
 * synchronous and cannot wait for it.
 */
export function known(): FfmpegStatus | null {
  return last;
}

/**
 * The ffmpeg to spawn directly, for the work the app does itself rather than
 * through yt-dlp — the same binary `--ffmpeg-location` would hand it. Falls
 * back to PATH when the probe found nothing better, and lets the spawn be the
 * thing that fails if even that is missing.
 */
export async function binary(): Promise<string> {
  const status_ = known() ?? (await status());

  return status_.location ? path.join(status_.location, "ffmpeg") : "ffmpeg";
}

async function run(): Promise<FfmpegStatus> {
  const dirs = candidateDirs();

  if (!dirs.length) {
    return finish({
      location: null,
      ok: false,
      error: "ffmpeg/ffprobe not found — yt-dlp cannot merge or remux without them"
    });
  }

  const broken: string[] = [];

  for (const dir of dirs) {
    const bad = await firstBroken(dir);

    if (!bad) return finish({ location: dir, ok: true });

    console.warn(`ffmpeg: ignoring ${bad}`);
    broken.push(bad);
  }

  // Nothing usable. Leave the location unset so yt-dlp still finds whatever
  // is on PATH — a broken ffmpeg is not worse than none — and report it.
  return finish({
    location: null,
    ok: false,
    error: `ffmpeg is crashing: ${broken[0]}`
  });
}

function finish(result: FfmpegStatus): FfmpegStatus {
  last = result;

  if (result.ok) {
    console.log(`ffmpeg: using ${result.location}`);
  } else {
    console.warn(`ffmpeg: ${result.error}`);
  }

  return result;
}

/** Every directory holding both binaries, in the order yt-dlp would find them. */
function candidateDirs(): string[] {
  const configured = process.env.FFMPEG_LOCATION?.trim();

  const raw = [
    // A binary path is accepted as well as a directory, matching yt-dlp.
    ...(configured ? [isDir(configured) ? configured : path.dirname(configured)] : []),
    ...(process.env.PATH ?? "").split(path.delimiter),
    ...EXTRA_DIRS
  ];

  const seen = new Set<string>();

  return raw
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.resolve(dir))
    .filter((dir) => {
      if (seen.has(dir)) return false;
      seen.add(dir);

      return hasBinary(dir, "ffmpeg") && hasBinary(dir, "ffprobe");
    });
}

function isDir(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function hasBinary(dir: string, name: string): boolean {
  try {
    fs.accessSync(path.join(dir, name), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The name of the first binary in `dir` that fails the probe, or null. */
async function firstBroken(dir: string): Promise<string | null> {
  for (const name of ["ffmpeg", "ffprobe"] as const) {
    const bin = path.join(dir, name);

    const args =
      name === "ffmpeg"
        ? ["-hide_banner", "-v", "quiet", "-i", PROBE_URL, "-f", "null", "-"]
        : ["-hide_banner", "-v", "quiet", "-i", PROBE_URL];

    const signal = await probe(bin, args);

    if (signal) return `${bin} (died on ${signal})`;
  }

  return null;
}

/**
 * Runs one probe and reports the signal that killed it, if any. The exit code
 * is deliberately ignored: failing to resolve the host is the expected
 * outcome and says nothing about the binary's health. Dying on a signal does.
 */
function probe(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(bin, args, { stdio: "ignore" });
    } catch {
      // Not executable at all — not the failure this probe is looking for,
      // and the directory scan already checked the bit.
      resolve(null);
      return;
    }

    // A resolver that hangs is not a crash, so a timeout counts as a pass.
    // Our own kill must not be mistaken for the binary falling over.
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, PROBE_TIMEOUT_MS);

    timer.unref();

    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });

    child.on("close", (_code, signal) => {
      clearTimeout(timer);
      resolve(timedOut ? null : signal);
    });
  });
}
