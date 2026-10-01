import { sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { channel } from "../../db/schema.js";
import { getLastCheck } from "../../utils/last-check.helper.js";
import { decorateChannel } from "../../services/avatar.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => {
    return { ok: true };
  });

  app.get("/api/last-video", async () => {
    const [row] = await db.select()
      .from(channel)
      .where(sql`lastCaptureAt IS NOT NULL`)
      .orderBy(sql`datetime(lastCaptureAt) DESC`)
      .limit(1);

    if (!row) {
      return { ok: false, message: "No captured videos yet." };
    }

    return {
      ok: true,
      video: {
        id: row.lastVideoId,
        title: row.lastVideoTitle,
        description: row.lastVideoDescription,
        thumbnail: row.lastVideoThumbnailPath,
        capturedAt: row.lastCaptureAt
      },
      channel: {
        id: row.id,
        name: row.name,
        channelId: row.channelId,
        avatar: decorateChannel(row).channelAvatarPath,
        rssUrl: row.rssUrl
      }
    };
  });

  app.get("/api/next-check", async () => await getLastCheck());
}