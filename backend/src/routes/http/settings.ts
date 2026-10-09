import { FastifyInstance } from "fastify";
import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import * as ytdlp from "../../services/ytdlp.js";
import { publishDownloaderStatus } from "../ws/downloader-status.js";
import * as Telegram from "../../services/telegram/bot.js";
import {
  normalizeTimeZone,
  rescheduleAllChannels
} from "../../utils/time-zone.helper.js";

/**
 * True when the text has at least one Netscape cookie line: seven
 * tab-separated fields. Comments are skipped, except the `#HttpOnly_` prefix
 * browsers export, which is a real cookie line.
 */
function looksLikeNetscapeCookies(text: string): boolean {
  return text.split("\n").some((line) => {
    const entry = line.startsWith("#HttpOnly_")
      ? line.slice("#HttpOnly_".length)
      : line;

    return !entry.startsWith("#") && entry.split("\t").length === 7;
  });
}

export async function settingsRoutes(app: FastifyInstance) {
  app.post("/api/settings/validate-ytdlp", async (req) => {
    const body = (req.body ?? {}) as { downloadsDir?: string };

    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    // Validate against the values being edited, not the ones already saved.
    const health = await ytdlp.checkHealth({
      ...row,
      downloadsDir: body.downloadsDir ?? row?.downloadsDir ?? null
    });

    return {
      status: health.ok,
      version: health.version,
      error: health.error ?? null
    };
  });

  app.get("/api/settings", async () => {
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    return row;
  });

  app.post("/api/settings", async (req) => {
    const body = req.body as {
      enabled: boolean | null;
      webhookUrl?: string | null;
      downloadsDir?: string | null;
      ytdlpArgs?: string | null;
      ytdlpConcurrency?: number | string | null;
      timeZone?: string | null;
      embedVideoCover?: boolean | null;
      telegramEnabled?: boolean | null;
      telegramBotToken?: string | null;
      telegramApiUrl?: string | null;
      telegramKeepFiles?: boolean | null;
      telegramNoDescription?: boolean | null;
      notifyDownloadFailed?: boolean | null;
    };

    const [previous] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    // Left as it was when the body does not mention it, so a client that
    // predates the field cannot wipe the zone by saving something else.
    const timeZone =
      "timeZone" in body
        ? normalizeTimeZone(body.timeZone)
        : previous?.timeZone ?? null;

    const concurrency = Math.min(
      Math.max(Number(body.ytdlpConcurrency) || 2, 1),
      10
    );

    await db
      .update(settings)
      .set({
        enabled: body.enabled ?? true,
        webhookUrl: body.webhookUrl ?? null,
        downloadsDir:
          body.downloadsDir?.trim() || ytdlp.DEFAULT_DOWNLOADS_DIR,
        ytdlpArgs: body.ytdlpArgs?.trim() || null,
        ytdlpConcurrency: concurrency,
        timeZone,
        // Same rule as the zone: an older client that never sends it keeps
        // whatever was saved.
        embedVideoCover:
          "embedVideoCover" in body
            ? body.embedVideoCover === true
            : previous?.embedVideoCover ?? false,
        // Same rule for every field added since: absent means unchanged.
        ...("telegramEnabled" in body ? { telegramEnabled: body.telegramEnabled === true } : {}),
        ...("telegramBotToken" in body ? { telegramBotToken: body.telegramBotToken?.trim() || null } : {}),
        ...("telegramApiUrl" in body ? { telegramApiUrl: body.telegramApiUrl?.trim() || null } : {}),
        ...("telegramKeepFiles" in body ? { telegramKeepFiles: body.telegramKeepFiles === true } : {}),
        ...("telegramNoDescription" in body ? { telegramNoDescription: body.telegramNoDescription === true } : {}),
        ...("notifyDownloadFailed" in body ? { notifyDownloadFailed: body.notifyDownloadFailed === true } : {}),
        updatedAt: new Date().toISOString()
      })
      .where(eq(settings.id, 1));

    const [updated] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    // The downloads dir feeds the health check, so a save is
    // one of the few moments the status can actually change.
    void publishDownloaderStatus().catch((e) =>
      console.warn("downloader-status: check after settings save failed:", e)
    );

    if ((previous?.timeZone ?? null) !== timeZone) {
      await rescheduleAllChannels(timeZone);
    }

    const telegramChanged =
      previous?.telegramEnabled !== updated.telegramEnabled ||
      previous?.telegramBotToken !== updated.telegramBotToken ||
      previous?.telegramApiUrl !== updated.telegramApiUrl;

    // Read on every call, so it applies without a restart.
    Telegram.setNoDescription(updated.telegramNoDescription);

    if (telegramChanged) await Telegram.restart({ previous, next: updated });

    return updated;
  });

  /**
   * Replaces the cookies file with the uploaded one. It arrives as the file's
   * own text, like the image uploads, and is the only way cookiesPath is set:
   * the settings save leaves it alone.
   */
  app.post(
    "/api/settings/cookies",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req, reply) => {
      const text =
        typeof req.body === "string"
          ? req.body.replace(/\r\n?/g, "\n")
          : "";

      if (!looksLikeNetscapeCookies(text)) {
        return reply
          .code(400)
          .send({ error: "Not a Netscape-format cookies.txt file" });
      }

      const file = path.resolve(ytdlp.COOKIES_FILE);

      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, text, { mode: 0o600 });
      // writeFile only applies the mode when it creates the file.
      await fsp.chmod(file, 0o600);

      return setCookiesPath(file);
    }
  );

  /**
   * Stops passing cookies to yt-dlp. Only the uploaded file is deleted; a
   * path set by hand before uploads existed may be a mount, so it is just
   * forgotten.
   */
  app.delete("/api/settings/cookies", async () => {
    const file = path.resolve(ytdlp.COOKIES_FILE);
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    if (row?.cookiesPath && path.resolve(row.cookiesPath) === file) {
      await fsp.rm(file, { force: true });
    }

    return setCookiesPath(null);
  });

  /**
   * Fills in the zone only while none is saved. The client calls this with
   * the browser's zone on every load, so it has to leave a zone someone
   * picked on the settings page alone - otherwise the last browser to open
   * the app would decide it.
   */
  app.post("/api/settings/time-zone", async (req, reply) => {
    const body = (req.body ?? {}) as { timeZone?: string | null };
    const timeZone = normalizeTimeZone(body.timeZone);

    if (!timeZone) {
      return reply.code(400).send({ error: "Unknown time zone" });
    }

    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    if (row?.timeZone) return row;

    await db
      .update(settings)
      .set({ timeZone, updatedAt: new Date().toISOString() })
      .where(eq(settings.id, 1));

    await rescheduleAllChannels(timeZone);

    const [updated] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    return updated;
  });
}

async function setCookiesPath(cookiesPath: string | null) {
  await db
    .update(settings)
    .set({ cookiesPath, updatedAt: new Date().toISOString() })
    .where(eq(settings.id, 1));

  void publishDownloaderStatus().catch((e) =>
    console.warn("downloader-status: check after cookies change failed:", e)
  );

  const [updated] = await db
    .select()
    .from(settings)
    .where(eq(settings.id, 1));

  return updated;
}
