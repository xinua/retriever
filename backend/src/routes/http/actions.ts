import { FastifyInstance } from "fastify";
import { runChannelOnce } from "../../services/worker.js";
import { db } from "../../db/index.js";
import { settings, channel } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { sendWebhook } from "../../services/webhook.js";

export async function actionsRoutes(app: FastifyInstance) {
  // Send webhook
  app.post("/api/actions/send-webhook", async (req) => {
    // The UI posts the example payload so the receiver sees the real shape;
    // an empty object is still accepted for bare connectivity checks.
    const { url, body } = req.body as {
      url: string;
      body?: Record<string, unknown>;
    };

    try {
      await sendWebhook(url, body ?? {});

      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  });

  // Run one channel scan
  app.post("/api/actions/run-once/:id", async (req) => {
    const { id } = req.params as { id: string };

    const [ch] = await db
      .select()
      .from(channel)
      .where(eq(channel.id, Number(id)));

    if (!ch) return { error: "Channel not found" };

    await runChannelOnce(Number(id));

    return { ok: true };
  });

  // Toggle global app state (enabled/disabled)
  app.post("/api/actions/toggle-enabled", async () => {
    const [s] = await db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));

    await db
      .update(settings)
      .set({ enabled: !s.enabled })
      .where(eq(settings.id, 1));

    return { enabled: !s.enabled };
  });
}