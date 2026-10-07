import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { db } from "../../db/index.js";
import { telegramChatAvatar } from "../../db/schema.js";
import * as Jpeg from "../jpeg.js";
import * as Bot from "./bot.js";
import * as Chats from "./chats.js";

/**
 * Chat photos, kept in the database so showing one never calls Telegram.
 * Fetched when a chat is approved, or on demand; a photo whose
 * file_unique_id has not changed is not downloaded again. An uploaded one
 * stays until the next fetch replaces it.
 */

/** Twice the 160 px Telegram serves, for a sharp picture on a dense screen. */
const UPLOAD_BOX = 320;

export async function get(chatId: string): Promise<Buffer | undefined> {
  const [row] = await db.select().from(telegramChatAvatar).where(eq(telegramChatAvatar.chatId, chatId));

  return row?.data;
}

export async function remove(chatId: string): Promise<void> {
  await db.delete(telegramChatAvatar).where(eq(telegramChatAvatar.chatId, chatId));
}

/**
 * Brings the stored photo in line with the chat's current one. Never throws:
 * an avatar is not worth failing an approval over.
 */
export async function refresh(chatId: string): Promise<void> {
  const api = Bot.getApi();

  if (!api) return;

  try {
    const chat = await Chats.get(chatId);

    if (!chat) return;

    // No photo, or one the user's privacy settings hide from the bot.
    const photo = (await api.getChat(chatId)).photo;

    if (!photo) {
      if (chat.avatarId) {
        await remove(chatId);
        await Chats.update(chatId, { avatarId: null });
      }

      return;
    }

    if (photo.small_file_unique_id === chat.avatarId) return;

    const file = await api.getFile(photo.small_file_id);

    if (!file.file_path) return;

    const data = await download(api.token, file.file_path);

    if (!data) return;

    await save(chatId, photo.small_file_unique_id, data);
  } catch (e) {
    console.warn(`telegram: avatar of ${chatId} failed:`, Bot.describe(e));
  }
}

/**
 * Stores an uploaded picture as the chat's avatar, re-encoded to JPEG and
 * shrunk to fit UPLOAD_BOX. Resolves to false when the image cannot be read.
 */
export async function upload(chatId: string, image: Buffer): Promise<boolean> {
  if (!image.length) return false;

  const temp = path.join(os.tmpdir(), `retriever-tg-avatar-${crypto.randomUUID()}`);
  const jpeg = `${temp}.jpg`;

  try {
    await fs.writeFile(temp, image);

    if (!(await Jpeg.convert(temp, jpeg, { kind: "box", max: UPLOAD_BOX }))) return false;

    const data = await fs.readFile(jpeg);

    // Never a Telegram id, so the next fetch always sees a change.
    const id = `custom-${crypto.createHash("sha1").update(data).digest("hex").slice(0, 16)}`;

    await save(chatId, id, data);

    return true;
  } catch (e) {
    console.warn(`telegram: avatar upload for ${chatId} failed:`, e);
    return false;
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
    await fs.rm(jpeg, { force: true }).catch(() => {});
  }
}

async function save(chatId: string, avatarId: string, data: Buffer): Promise<void> {
  const values = { chatId, fileUniqueId: avatarId, data, updatedAt: new Date().toISOString() };

  await db
    .insert(telegramChatAvatar)
    .values(values)
    .onConflictDoUpdate({ target: telegramChatAvatar.chatId, set: values });

  await Chats.update(chatId, { avatarId });
}

/**
 * The cloud serves files over HTTP. A local Bot API server hands back an
 * absolute path on its own disk instead, readable only when that disk is
 * shared with this container.
 */
async function download(token: string, filePath: string): Promise<Buffer | null> {
  if (Bot.isLocal()) {
    return fs.readFile(filePath).catch((e) => {
      console.warn(`telegram: avatar file ${filePath} is not reachable from here:`, Bot.describe(e));

      return null;
    });
  }

  const res = await fetch(`${Bot.CLOUD_API_ROOT}/file/bot${token}/${filePath}`);

  // The URL carries the token, so it stays out of the message.
  if (!res.ok) throw new Error(`avatar download failed: HTTP ${res.status}`);

  return Buffer.from(await res.arrayBuffer());
}
