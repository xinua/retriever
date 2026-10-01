import { Api, Bot, GrammyError, type Context } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { broadcast } from "../../routes/ws/websockets.js";
import * as Chats from "./chats.js";
import * as Download from "./download.js";

import type { Settings } from "../../db/types.js";

/**
 * The one Telegram bot: notifications go out through its API, and the
 * download bot runs on its updates. Long polling, so nothing has to be
 * reachable from the internet.
 *
 * Every chat goes through the whitelist first. A chat the UI has not
 * approved gets no answer at all - a /start from it only puts it on the list
 * as pending.
 */

export const CLOUD_API_ROOT = "https://api.telegram.org";

const MB = 1024 * 1024;

/**
 * What the Bot API accepts for an upload: 50 MB from api.telegram.org, 2000 MB
 * from a local server.
 */
const CLOUD_LIMIT = 50 * MB;
const LOCAL_LIMIT = 2000 * MB;

/** A 2 GB upload to a slow uplink takes a while; grammY's default is 500 s. */
const TIMEOUT_SECONDS = 1800;

/** logOut is a quick call; an unreachable server should not hold up a save. */
const LOGOUT_TIMEOUT_SECONDS = 15;

export type TelegramStatus = {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  username: string | null;
  error: string | null;
  /** The bot runs, but the hand-over between Bot API servers went wrong. */
  warning: string | null;
  local: boolean;
  apiRoot: string;
  limitMb: number;
};

let bot: Bot | null = null;
let api: Api | null = null;
let apiRoot = CLOUD_API_ROOT;

/** Bumped on every restart, so a stale start() cannot touch the new bot. */
let generation = 0;

let status: TelegramStatus = statusFor(null, false);

function statusFor(row: Settings | null | undefined, running: boolean, extra: Partial<TelegramStatus> = {}): TelegramStatus {
  const root = rootFor(row);
  const local = root !== CLOUD_API_ROOT;

  return {
    enabled: !!row?.telegramEnabled,
    configured: !!row?.telegramBotToken?.trim(),
    running,
    username: null,
    error: null,
    warning: null,
    local,
    apiRoot: root,
    limitMb: (local ? LOCAL_LIMIT : CLOUD_LIMIT) / MB,
    ...extra
  };
}

function rootFor(row: Settings | null | undefined): string {
  return row?.telegramApiUrl?.trim().replace(/\/+$/, "") || CLOUD_API_ROOT;
}

function setStatus(next: TelegramStatus) {
  status = next;
  broadcast("telegram-status", status);
}

export function getStatus(): TelegramStatus {
  return status;
}

/** The bot's API, or null while Telegram is off or has no token. */
export function getApi(): Api | null {
  return api;
}

/** Whether files are handed to the Bot API server by path. */
export function isLocal(): boolean {
  return apiRoot !== CLOUD_API_ROOT;
}

export function uploadLimit(): number {
  return isLocal() ? LOCAL_LIMIT : CLOUD_LIMIT;
}

/**
 * Restarts the bot on the saved settings. Given the settings before and after
 * a save, it first hands the bot over when the save moved it to another Bot
 * API server.
 */
export async function restart(change?: { previous: Settings | null | undefined; next: Settings | null | undefined }): Promise<void> {
  await stop();

  const warning = change ? await handOver(change.previous, change.next) : null;

  await start(warning);
}

export async function stop(): Promise<void> {
  generation++;

  const current = bot;

  bot = null;
  api = null;

  if (current?.isRunning()) {
    await current.stop().catch((e) => console.warn("telegram: stop failed:", e));
  }
}

export async function start(warning: string | null = null): Promise<void> {
  const mine = ++generation;

  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  const token = row?.telegramBotToken?.trim();

  apiRoot = rootFor(row);

  if (!row?.telegramEnabled || !token) {
    setStatus(statusFor(row, false, { warning }));
    return;
  }

  const next = new Bot(token, {
    client: { apiRoot, timeoutSeconds: TIMEOUT_SECONDS }
  });

  register(next);

  bot = next;
  api = next.api;

  try {
    await next.init();
  } catch (e) {
    if (mine !== generation) return;

    setStatus(statusFor(row, false, { error: describe(e), warning }));
    return;
  }

  if (mine !== generation) return;

  const username = next.botInfo.username;

  await next.api
    .setMyCommands([{ command: "start", description: "Request access / show help" }])
    .catch((e) => console.warn("telegram: setMyCommands failed:", e));

  setStatus(statusFor(row, true, { username, warning }));

  // Resolves once polling stops; rejects when it cannot continue at all - a
  // revoked token, or another process polling the same one (409).
  void next
    .start({
      allowed_updates: ["message", "callback_query"],
      onStart: () => console.log(`telegram: polling as @${username} via ${apiRoot}`)
    })
    .catch((e) => {
      if (mine !== generation) return;

      console.warn("telegram: polling stopped:", e);
      setStatus(statusFor(row, false, { username, error: describe(e), warning }));
    });
}

export function describe(e: unknown): string {
  if (e instanceof GrammyError) return e.description;
  if (e instanceof Error) return e.message;

  return String(e);
}

function register(next: Bot) {
  next.catch((err) => console.warn("telegram: handler failed:", err.error));

  next.use(whitelist);

  next.command(["start", "help"], (ctx) =>
    ctx.reply("Send me a link to a single video and pick a resolution or MP3. I will download it and send the file back.")
  );

  next.on("callback_query:data", Download.onButton);
  next.on("message:text", Download.onText);
}

/**
 * Lets an approved chat through and nothing else. A /start from a chat the
 * bot has never seen adds it as pending and tells the UI; anything else from
 * an unapproved chat is dropped without a word.
 */
async function whitelist(ctx: Context, next: () => Promise<void>) {
  const chat = ctx.chat;

  if (!chat) return;

  const chatId = String(chat.id);
  const row = await Chats.get(chatId);

  if (row?.status === "approved") return next();

  if (row || !/^\/start(@\w+)?(\s|$)/.test(ctx.message?.text ?? "")) return;

  const name =
    ("title" in chat && chat.title) ||
    [("first_name" in chat && chat.first_name) || "", ("last_name" in chat && chat.last_name) || ""]
      .join(" ")
      .trim() ||
    ("username" in chat && chat.username) ||
    chatId;

  const { created } = await Chats.ensure({
    chatId,
    type: chat.type,
    name,
    username: ("username" in chat && chat.username) || null
  });

  if (created) {
    broadcast("notification", {
      type: "info",
      title: "Telegram",
      subtitle: "New chat waiting for approval",
      message: name
    });
  }
}

/** Tells a chat it has just been let in. */
export async function welcome(chatId: string): Promise<void> {
  await api
    ?.sendMessage(chatId, "✅ Access granted. Send me a link to a single video.")
    .catch((e) => console.warn(`telegram: welcome to ${chatId} failed:`, describe(e)));
}

/**
 * Moves the bot between Bot API servers, which Telegram wants done by hand:
 * a bot still logged in to the server it left can keep getting its updates
 * there, where nobody reads them.
 *
 * - Leaving a local server: log out of it, so it drops the bot's session.
 * - Arriving on a local server from the cloud, or with a new token: log out
 *   of api.telegram.org first. The cloud then refuses the bot for 10 minutes,
 *   which is why this only runs when the server really changes.
 *
 * Done whether Telegram is on or off, so turning it off, changing the URL and
 * turning it back on later does not skip the step. Never throws: a failure
 * comes back as a warning, and the bot starts anyway.
 */
async function handOver(previous: Settings | null | undefined, next: Settings | null | undefined): Promise<string | null> {
  const prevToken = previous?.telegramBotToken?.trim() || null;
  const nextToken = next?.telegramBotToken?.trim() || null;
  const prevRoot = rootFor(previous);
  const nextRoot = rootFor(next);

  const warnings: string[] = [];

  if (prevToken && prevRoot !== CLOUD_API_ROOT && prevRoot !== nextRoot) {
    const failed = await logOutFrom(prevRoot, prevToken);

    if (failed) warnings.push(`Could not log out of ${prevRoot}: ${failed}`);
  }

  if (nextToken && nextRoot !== CLOUD_API_ROOT && (prevRoot === CLOUD_API_ROOT || prevToken !== nextToken)) {
    const failed = await logOutFrom(CLOUD_API_ROOT, nextToken);

    if (failed) {
      warnings.push(`Could not log out of the cloud API, so the local server may miss updates: ${failed}`);
    }
  }

  return warnings.join(" ") || null;
}

/** Logs the bot out of one server. Resolves to the error, or null when it worked. */
async function logOutFrom(root: string, token: string): Promise<string | null> {
  try {
    await new Api(token, { apiRoot: root, timeoutSeconds: LOGOUT_TIMEOUT_SECONDS }).logOut();
    console.log(`telegram: logged out of ${root}`);

    return null;
  } catch (e) {
    const error = describe(e);

    // Logged out already, by an earlier save or by hand: the goal is met.
    if (/logged out/i.test(error)) return null;

    console.warn(`telegram: log out of ${root} failed:`, error);

    return error;
  }
}
