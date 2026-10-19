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
  telegramNoDescription?: boolean;
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
  telegramNoDescription: FormControl<boolean>;
  notifyDownloadFailed: FormControl<boolean>;
}

/** One entry of a folder inside the mounted root. */
export interface FolderEntryModel {
  name: string;
  type: 'folder' | 'file';
  /** A folder that is a separate filesystem: a ZFS dataset, a btrfs subvolume, another disk. */
  mount: boolean;
}

/** One level of the mounted root, as `GET /api/folders` lists it. */
export interface FolderListingModel {
  /** The listed folder relative to the root, "" for the root itself. */
  path: string;
  /** Folders first, then files (only when asked for). */
  entries: FolderEntryModel[];
  /** The folder held more entries than were sent. */
  truncated: boolean;
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
  /** What an empty Bot API URL stands for. */
  defaultApiRoot: string;
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
