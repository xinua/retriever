import { InputFile, type Api } from "grammy";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as Jpeg from "../jpeg.js";
import { describe } from "./bot.js";

/**
 * Gives a bot that has no profile photo the app's own picture, so a freshly
 * created bot does not show up in Telegram as a bare letter. A bot that has a
 * photo - one set in BotFather, or this one from an earlier start - is left
 * alone.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEB_ROOT = path.resolve(process.env.WEB_ROOT ?? path.join(__dirname, "../../../public"));

/** Shipped with the frontend; served by the UI as well. */
const SOURCE = path.join(WEB_ROOT, "assets/images/tg_avatar.png");

/**
 * Sets the default photo when the bot has none. Never throws: a photo is not
 * worth failing a start over. When the bot's photos cannot be read, nothing
 * is set, so a photo it may have is never replaced.
 */
export async function ensure(api: Api, botId: number): Promise<void> {
  const temp = path.join(os.tmpdir(), `retriever-tg-profile-${crypto.randomUUID()}.jpg`);

  try {
    const photos = await api.getUserProfilePhotos(botId, { limit: 1 });

    if (photos.total_count > 0) return;

    // The Bot API takes a static profile photo as JPEG only.
    if (!(await Jpeg.convert(SOURCE, temp))) {
      console.warn(`telegram: default profile photo ${SOURCE} could not be read`);
      return;
    }

    await api.setMyProfilePhoto({ type: "static", photo: new InputFile(temp) });

    console.log("telegram: set the default profile photo");
  } catch (e) {
    console.warn("telegram: default profile photo failed:", describe(e));
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}
