import { FastifyInstance } from "fastify";

import * as Avatar from "../../services/telegram/avatar.js";
import * as Bot from "../../services/telegram/bot.js";
import * as Chats from "../../services/telegram/chats.js";
import * as TelegramNotify from "../../services/telegram/notify.js";

export async function telegramRoutes(app: FastifyInstance) {
  app.get("/api/telegram/status", async () => Bot.getStatus());

  /** Sends a test message to every chat with notifications on. */
  app.post("/api/telegram/test", async (_req, reply) => {
    try {
      return { ok: true, ...(await TelegramNotify.test()) };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: Bot.describe(e) });
    }
  });

  app.get("/api/telegram/chats", async () => (await Chats.list()).map(Chats.present));

  /**
   * Adds a chat by hand, already approved: a group or channel the bot was
   * added to, where nobody can send /start.
   */
  app.post("/api/telegram/chats", async (req, reply) => {
    const body = (req.body ?? {}) as { chatId?: string | number; name?: string | null };
    const chatId = String(body.chatId ?? "").trim();

    if (!/^-?\d+$/.test(chatId)) {
      return reply.code(400).send({ error: "Chat ID must be a number" });
    }

    const { row, created } = await Chats.ensure({
      chatId,
      name: body.name?.trim() || chatId,
      status: "approved"
    });

    if (!created) return reply.code(409).send({ error: "That chat is already on the list" });

    void Avatar.refresh(chatId);

    return Chats.present(row);
  });

  app.patch("/api/telegram/chats/:chatId", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const body = (req.body ?? {}) as { name?: string | null; status?: string; notify?: boolean };

    const previous = await Chats.get(chatId);

    if (!previous) return reply.code(404).send({ error: "Chat not found" });

    if (body.status !== undefined && !Chats.CHAT_STATUSES.includes(body.status as Chats.ChatStatus)) {
      return reply.code(400).send({ error: `Unknown status "${body.status}"` });
    }

    const row = await Chats.update(chatId, {
      ...(body.name !== undefined ? { name: body.name?.trim() || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notify !== undefined ? { notify: body.notify === true } : {})
    });

    if (previous.status !== "approved" && row?.status === "approved") {
      void Bot.welcome(chatId);
      void Avatar.refresh(chatId);
    }

    return row && Chats.present(row);
  });

  /** The stored photo; Telegram is not called. 404 when the chat has none. */
  app.get("/api/telegram/chats/:chatId/avatar", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    const data = await Avatar.get(chatId);

    if (!data) return reply.code(404).send({ error: "No avatar" });

    // Immutable: a new photo gets a new URL (see Chats.present).
    return reply
      .type("image/jpeg")
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(data);
  });

  /** Fetches the photo again - for chats approved before avatars existed, or a changed photo. */
  app.post("/api/telegram/chats/:chatId/avatar", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };

    if (!(await Chats.get(chatId))) return reply.code(404).send({ error: "Chat not found" });

    await Avatar.refresh(chatId);

    const row = await Chats.get(chatId);

    return row ? Chats.present(row) : reply.code(404).send({ error: "Chat not found" });
  });

  /**
   * Replaces the avatar with the uploaded picture (the request body is the
   * image itself). Kept until the chat is approved again or re-fetched.
   */
  app.put("/api/telegram/chats/:chatId/avatar", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };

    if (!Buffer.isBuffer(req.body)) {
      return reply.code(415).send({ error: "Send the image as the request body" });
    }

    if (!(await Chats.get(chatId))) return reply.code(404).send({ error: "Chat not found" });

    if (!(await Avatar.upload(chatId, req.body))) {
      return reply.code(422).send({ error: "The image could not be read" });
    }

    const row = await Chats.get(chatId);

    return row ? Chats.present(row) : reply.code(404).send({ error: "Chat not found" });
  });

  app.delete("/api/telegram/chats/:chatId", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };

    if (!(await Chats.remove(chatId))) return reply.code(404).send({ error: "Chat not found" });

    return { ok: true };
  });
}
