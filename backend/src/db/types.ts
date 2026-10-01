import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { channel, download, settings, telegramChat, uiConfig } from "./schema.js";

export type Channel = InferSelectModel<typeof channel>;
export type NewChannel = InferInsertModel<typeof channel>;

export type Settings = InferSelectModel<typeof settings>;
export type Download = InferSelectModel<typeof download>;
export type NewDownload = InferInsertModel<typeof download>;

export type UiConfig = InferSelectModel<typeof uiConfig>;

export type TelegramChat = InferSelectModel<typeof telegramChat>;
