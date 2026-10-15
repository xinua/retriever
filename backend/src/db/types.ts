import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { subscription, download, settings, telegramChat } from "./schema.js";

export type Subscription = InferSelectModel<typeof subscription>;
export type NewSubscription = InferInsertModel<typeof subscription>;

export type Settings = InferSelectModel<typeof settings>;
export type Download = InferSelectModel<typeof download>;
export type NewDownload = InferInsertModel<typeof download>;

export type TelegramChat = InferSelectModel<typeof telegramChat>;
