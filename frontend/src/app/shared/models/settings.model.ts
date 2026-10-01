import { FormControl } from '@angular/forms';
import { Nullable } from '../../shared/models';

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
  updatedAt?: Date;
  createdAt?: Date;
}

export interface SettingsFormModel {
  webhookUrl: FormControl<Nullable<string>>;
  downloadsDir: FormControl<Nullable<string>>;
  cookiesPath: FormControl<Nullable<string>>;
  ytdlpArgs: FormControl<Nullable<string>>;
  ytdlpConcurrency: FormControl<number>;
  timeZone: FormControl<Nullable<string>>;
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
