import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import * as ytdlp from "../../services/ytdlp.js";
import { publishDownloaderStatus } from "../ws/downloader-status.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.post("/api/settings/validate-ytdlp", async (req) => {
    const body = (req.body ?? {}) as {
      downloadsDir?: string;
      cookiesPath?: string | null;
    };

    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    // Validate against the values being edited, not the ones already saved.
    const health = await ytdlp.checkHealth({
      ...row,
      downloadsDir: body.downloadsDir ?? row?.downloadsDir ?? null,
      cookiesPath: body.cookiesPath ?? row?.cookiesPath ?? null
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
      cookiesPath?: string | null;
      ytdlpArgs?: string | null;
      ytdlpConcurrency?: number | string | null;
    };

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
        cookiesPath: body.cookiesPath?.trim() || null,
        ytdlpArgs: body.ytdlpArgs?.trim() || null,
        ytdlpConcurrency: concurrency,
        updatedAt: new Date().toISOString()
      })
      .where(eq(settings.id, 1));

    const [updated] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    // The downloads dir and cookies path feed the health check, so a save is
    // one of the few moments the status can actually change.
    void publishDownloaderStatus().catch((e) =>
      console.warn("downloader-status: check after settings save failed:", e)
    );

    return updated;
  });
}