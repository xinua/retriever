import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { broadcast } from "./websockets.js";
import * as ytdlp from "../../services/ytdlp.js";

export type DownloaderStatus = {
  downloader: "ytdlp";
  status: boolean;
  detail: string | null;
};

/**
 * Pushes the current status to every open tab. Event-driven on purpose: the
 * status only moves when the binary, ffmpeg, or the settings change, and
 * every one of those happens through a route that can call this. A timer
 * here used to spawn `yt-dlp --version` every few seconds for as long as a
 * tab was open, which on a NAS showed up as constant CPU load.
 */
export async function publishDownloaderStatus() {
  broadcast("downloader-status", await checkDownloaderStatus());
}

export async function checkDownloaderStatus(): Promise<DownloaderStatus> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));

  if (!row) {
    return { downloader: "ytdlp", status: false, detail: null };
  }

  const health = await ytdlp.checkHealth(row);

  return {
    downloader: "ytdlp",
    status: health.ok,
    // checkHealth also reports non-fatal problems — a broken ffmpeg leaves
    // yt-dlp itself usable — so a message wins over the version even when
    // the status is good.
    detail: health.error ?? health.version
  };
}
