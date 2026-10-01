import { FastifyInstance } from "fastify";

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

  app.get("/api/telegram/chats", async () => Chats.list());

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

    return row;
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
    }

    return row;
  });

  app.delete("/api/telegram/chats/:chatId", async (req, reply) => {
    const { chatId } = req.params as { chatId: string };

    if (!(await Chats.remove(chatId))) return reply.code(404).send({ error: "Chat not found" });

    return { ok: true };
  });
}
