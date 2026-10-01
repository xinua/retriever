import { asc, eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { telegramChat } from "../../db/schema.js";
import { broadcast } from "../../routes/ws/websockets.js";

import type { TelegramChat } from "../../db/types.js";

export type ChatStatus = "pending" | "approved" | "blocked";

export const CHAT_STATUSES: readonly ChatStatus[] = ["pending", "approved", "blocked"];

export async function get(chatId: string): Promise<TelegramChat | undefined> {
  const [row] = await db.select().from(telegramChat).where(eq(telegramChat.chatId, chatId));
  return row;
}

export async function list(): Promise<TelegramChat[]> {
  return db.select().from(telegramChat).orderBy(asc(telegramChat.createdAt));
}

export async function notifyTargets(): Promise<TelegramChat[]> {
  return db.select().from(telegramChat).where(eq(telegramChat.notify, true));
}

export async function isApproved(chatId: string): Promise<boolean> {
  return (await get(chatId))?.status === "approved";
}

/** Inserts a chat, or returns the one already there untouched. */
export async function ensure(
  values: { chatId: string; type?: string | null; name?: string | null; username?: string | null; status?: ChatStatus }
): Promise<{ row: TelegramChat; created: boolean }> {
  const existing = await get(values.chatId);

  if (existing) return { row: existing, created: false };

  const now = new Date().toISOString();

  const [row] = await db
    .insert(telegramChat)
    .values({ ...values, status: values.status ?? "pending", createdAt: now, updatedAt: now })
    .returning();

  await publish();

  return { row, created: true };
}

export async function update(
  chatId: string,
  patch: Partial<Omit<TelegramChat, "chatId" | "createdAt" | "updatedAt">>
): Promise<TelegramChat | undefined> {
  const [row] = await db
    .update(telegramChat)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(telegramChat.chatId, chatId))
    .returning();

  if (row) await publish();

  return row;
}

export async function remove(chatId: string): Promise<boolean> {
  const rows = await db.delete(telegramChat).where(eq(telegramChat.chatId, chatId)).returning();

  if (rows.length) await publish();

  return rows.length > 0;
}

/** Pushes the whole list to open tabs; it is a handful of rows at most. */
async function publish(): Promise<void> {
  broadcast("telegram-chats", await list());
}
