import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { versionCheck } from "../db/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const URL_DEFAULT =
  "https://raw.githubusercontent.com/xinua/retriever/main/version.json";

const SOURCE_URL = process.env.VERSION_CHECK_URL?.trim() || URL_DEFAULT;

const ENABLED = !["0", "false", "no", "off"].includes(
  (process.env.VERSION_CHECK_ENABLED ?? "").trim().toLowerCase()
);

const FETCH_TIMEOUT_MS = 10_000;

/**
 * A failed check is retried well before the next daily slot — a flaky minute
 * of network at 01:00 should not leave the app blind until tomorrow — but not
 * so eagerly that an offline install hammers the network.
 */
const RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * The scheduler wakes at most this often, so a suspended host or a stepped
 * clock is noticed in minutes rather than whenever a day-long timer decides
 * to fire.
 */
const MAX_SLEEP_MS = 15 * 60 * 1000;

/**
 * How close to `now` the next slot is allowed to land. Without it a check
 * that runs at 23:50 would schedule the next one for ten minutes later, which
 * is the one thing a daily check must not do.
 */
const MIN_GAP_MS = 4 * 60 * 60 * 1000;

const WINDOW_DEFAULT = "00:00-02:00";

let timer: NodeJS.Timeout | null = null;
let checking = false;

interface CheckWindow {
  startMin: number;
  endMin: number;
}

/**
 * "HH:MM-HH:MM", in UTC, as minutes past midnight. Every install would
 * otherwise hit the same raw.githubusercontent.com object at the same instant;
 * the window is what the per-install jitter is drawn from.
 */
function parseWindow(raw: string | undefined): CheckWindow {
  const fallback = { startMin: 0, endMin: 120 };
  const value = raw?.trim();

  if (!value) return fallback;

  const m = value.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);

  if (!m) {
    console.warn(
      `version-check: could not read VERSION_CHECK_WINDOW "${value}", using ${WINDOW_DEFAULT}`
    );

    return fallback;
  }

  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);

  if (startMin >= endMin || endMin > 24 * 60) {
    console.warn(
      `version-check: VERSION_CHECK_WINDOW "${value}" is not a forward window inside one day, using ${WINDOW_DEFAULT}`
    );

    return fallback;
  }

  return { startMin, endMin };
}

const WINDOW = parseWindow(process.env.VERSION_CHECK_WINDOW);

/**
 * A random instant inside the window, on the first day whose slot is far
 * enough from `from`. Tomorrow's slot normally wins; only a check that ran
 * late in the evening skips to the day after. Exported for tests.
 */
export function nextSlot(from: Date): Date {
  const span = (WINDOW.endMin - WINDOW.startMin) * 60_000;

  for (let dayOffset = 1; dayOffset <= 2; dayOffset++) {
    const midnight = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + dayOffset
    );

    const at = midnight + WINDOW.startMin * 60_000 + Math.floor(Math.random() * span);

    if (at - from.getTime() >= MIN_GAP_MS) return new Date(at);
  }

  // Two days out is further than MIN_GAP_MS however the window is placed, so
  // this is unreachable - it exists so the loop above cannot be open-ended.
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * The running app's own version. In the image `package.json` sits next to
 * `dist/`; under tsx it is the backend package root — try both rather than
 * guess which one is running.
 */
function readCurrentVersion(): string | null {
  const candidates = [
    path.join(process.cwd(), "package.json"),
    path.resolve(__dirname, "../../package.json"),
    path.resolve(__dirname, "../../../package.json")
  ];

  for (const file of candidates) {
    try {
      const { version } = JSON.parse(fs.readFileSync(file, "utf8"));

      if (typeof version === "string") return version;
    } catch {
      // try the next candidate
    }
  }

  return null;
}

const CURRENT_VERSION = readCurrentVersion();

/**
 * Numeric-part comparison, tolerating a leading "v" and ignoring any
 * pre-release suffix: "1.2.0-rc1" counts as 1.2.0. Returns true when `latest`
 * is ahead of `current`.
 */
export function isNewer(latest: string | null, current: string | null): boolean {
  if (!latest || !current) return false;

  const parts = (v: string) =>
    v.trim().replace(/^v/i, "").split(/[-+]/, 1)[0].split(".").map(Number);

  const a = parts(latest);
  const b = parts(current);

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;

    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }

  return false;
}

async function getRow() {
  const [row] = await db
    .select()
    .from(versionCheck)
    .where(eq(versionCheck.id, 1));

  return row ?? null;
}

/**
 * Fetches the manifest and stores it. The stored row is the cache: it lives in
 * the database on the mounted volume, so restarting the container replays the
 * schedule it was already on instead of starting a fresh day.
 */
async function runCheck(): Promise<void> {
  if (checking) return;

  checking = true;

  const now = new Date();
  const nowIso = now.toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(SOURCE_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const payload = (await res.json()) as {
      version?: unknown;
      releaseDate?: unknown;
    };

    const latestVersion =
      typeof payload?.version === "string" ? payload.version : null;

    if (!latestVersion) throw new Error("manifest carries no version");

    await db
      .update(versionCheck)
      .set({
        latestVersion,
        releaseDate:
          typeof payload.releaseDate === "string" ? payload.releaseDate : null,
        payload: JSON.stringify(payload),
        checkedAt: nowIso,
        lastAttemptAt: nowIso,
        lastError: null,
        nextCheckAt: nextSlot(now).toISOString(),
        updatedAt: nowIso
      })
      .where(eq(versionCheck.id, 1));

    console.log(
      `version-check: latest ${latestVersion}, running ${CURRENT_VERSION ?? "unknown"}`
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    console.warn(`version-check: ${SOURCE_URL} failed: ${message}`);

    // The cached payload is deliberately left alone: a failed check should
    // degrade to yesterday's answer, not to no answer.
    await db
      .update(versionCheck)
      .set({
        lastAttemptAt: nowIso,
        lastError: message,
        nextCheckAt: new Date(now.getTime() + RETRY_AFTER_MS).toISOString(),
        updatedAt: nowIso
      })
      .where(eq(versionCheck.id, 1));
  } finally {
    clearTimeout(timeout);
    checking = false;
  }
}

/**
 * When the next check is due, as an epoch. A row that is unset - or that
 * carries a timestamp nothing can parse - counts as due now.
 */
function dueAt(row: Awaited<ReturnType<typeof getRow>>): number {
  const at = row?.nextCheckAt ? new Date(row.nextCheckAt).getTime() : NaN;

  return Number.isFinite(at) ? at : 0;
}

async function tick(): Promise<void> {
  let delay: number;

  try {
    const due = dueAt(await getRow()) <= Date.now();

    if (due) await runCheck();

    delay = dueAt(await getRow()) - Date.now();

    // A check that ran always moves the row on, so a still-due row means the
    // write itself did not land. Back off rather than spin on it.
    if (due && delay <= 0) delay = RETRY_AFTER_MS;
  } catch (e) {
    console.warn("version-check: tick failed:", e);

    delay = RETRY_AFTER_MS;
  }

  schedule(delay);
}

function schedule(delayMs: number): void {
  if (timer) clearTimeout(timer);

  timer = setTimeout(
    () => void tick(),
    Math.max(0, Math.min(delayMs, MAX_SLEEP_MS))
  );

  // The check must never be the reason the process stays alive.
  timer.unref?.();
}

/**
 * Runs one check per day, at a random time inside the configured window.
 *
 * A first boot has no cached manifest, so it checks straight away and then
 * settles into the window; every later boot reads `nextCheckAt` back out of
 * the database and waits for it, which is what keeps restarts - and a
 * container that restarts in a loop - off the network.
 */
export function startVersionCheck(): void {
  if (!ENABLED) {
    console.log("version-check: disabled by VERSION_CHECK_ENABLED");

    return;
  }

  if (timer) return;

  void tick();
}

export function stopVersionCheck(): void {
  if (!timer) return;

  clearTimeout(timer);
  timer = null;
}

export interface VersionInfo {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  nextCheckAt: string | null;
  error: string | null;
  version?: string;
  releaseDate?: string;
  changelog?: unknown;
}

/**
 * Answers from the cache only - the daily job is the only thing that talks to
 * the network. The manifest's own fields are spread on top so a client can
 * read `version` / `releaseDate` / `changelog` exactly as they appear in
 * version.json.
 */
export async function getVersionInfo(): Promise<VersionInfo> {
  const row = await getRow();

  let payload: Record<string, unknown> = {};

  if (row?.payload) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      // A manifest we cannot parse is no better than none.
    }
  }

  return {
    ...payload,
    current: CURRENT_VERSION,
    latest: row?.latestVersion ?? null,
    updateAvailable: isNewer(row?.latestVersion ?? null, CURRENT_VERSION),
    checkedAt: row?.checkedAt ?? null,
    nextCheckAt: row?.nextCheckAt ?? null,
    error: row?.checkedAt ? null : row?.lastError ?? null
  };
}
