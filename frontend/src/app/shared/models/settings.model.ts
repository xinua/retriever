import { FormControl } from '@angular/forms';
import { Nullable } from './common.model';

export interface SettingsModel {
  id?: number;
  enabled: boolean;
  webhookUrl: Nullable<string>;
  downloadsDir: Nullable<string>;
  cookiesPath: Nullable<string>;
  ytdlpArgs: Nullable<string>;
  ytdlpConcurrency: number;
  /** IANA zone poll hours are read in. `null` means the server's own clock. */
  timeZone: Nullable<string>;
  telegramEnabled?: boolean;
  telegramBotToken?: Nullable<string>;
  /** Null means api.telegram.org; anything else is a local Bot API server. */
  telegramApiUrl?: Nullable<string>;
  /** Keep a file the bot sent in the downloads folder instead of deleting it. */
  telegramKeepFiles?: boolean;
  notifyDownloadFailed?: boolean;
  updatedAt?: Date;
  createdAt?: Date;
}

export interface SettingsFormModel {
  webhookUrl: FormControl<Nullable<string>>;
  downloadsDir: FormControl<Nullable<string>>;
  ytdlpArgs: FormControl<Nullable<string>>;
  ytdlpConcurrency: FormControl<number>;
  timeZone: FormControl<Nullable<string>>;
  embedVideoCover: FormControl<boolean>;
  telegramEnabled: FormControl<boolean>;
  telegramBotToken: FormControl<Nullable<string>>;
  telegramApiUrl: FormControl<Nullable<string>>;
  telegramKeepFiles: FormControl<boolean>;
  notifyDownloadFailed: FormControl<boolean>;
}

/** Folders that already exist inside the downloads root, newest listing wins. */
export interface FoldersModel {
  /** Absolute path the folders are relative to, for the tooltip/hint. */
  root: string;
  /** Slash-joined paths relative to `root`, e.g. `podcasts/history`. */
  folders: string[];
}

export interface YtdlpStatusModel {
  status: boolean;
  version: Nullable<string>;
  error: Nullable<string>;
}

export interface YtdlpUpdateModel {
  ok: boolean;
  from: Nullable<string>;
  to: Nullable<string>;
  output: string;
}

/** Liveness of the optional POT provider server, when one is configured. */
export interface PotStatusModel {
  configured: boolean;
  baseUrl: Nullable<string>;
  ok: boolean;
  version: Nullable<string>;
  error: Nullable<string>;
}

/** The Telegram bot as the server sees it right now. */
export interface TelegramStatusModel {
  enabled: boolean;
  configured: boolean;
  warning: Nullable<string>;
  running: boolean;
  username: Nullable<string>;
  error: Nullable<string>;
  /** Talking to a local Bot API server rather than api.telegram.org. */
  local: boolean;
  apiRoot: string;
  limitMb: number;
}

export type TelegramChatStatus = 'pending' | 'approved' | 'blocked';

export interface TelegramChatModel {
  chatId: string;
  avatar: Nullable<string>;
  type: Nullable<string>;
  name: Nullable<string>;
  username: Nullable<string>;
  status: TelegramChatStatus;
  notify: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramTestResult {
  ok: boolean;
  sent: number;
  errors: { chatId: string; name: Nullable<string>; error: string }[];
}
