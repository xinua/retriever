import { Injectable } from '@angular/core';
import { DownloadInfoModel, DownloadModel, DownloadStatus } from '../src/app/shared/models/download.model';
import {
  FolderEntryModel,
  FolderListingModel,
  SettingsModel,
  TelegramChatModel,
} from '../src/app/shared/models/settings.model';
import { SubscriptionModel } from '../src/app/shared/models/subscription.model';
import { VersionModel } from '../src/app/shared/models/version.model';
import downloadsJson from '../../docs-assets/mock/downloads.json';
import foldersJson from '../../docs-assets/mock/folders.json';
import nextCheckJson from '../../docs-assets/mock/next-check.json';
import potJson from '../../docs-assets/mock/ytdlp-pot.json';
import settingsJson from '../../docs-assets/mock/settings.json';
import subscriptionsJson from '../../docs-assets/mock/subscriptions.json';
import telegramChatsJson from '../../docs-assets/mock/telegram-chats.json';
import telegramStatusJson from '../../docs-assets/mock/telegram-status.json';
import versionJson from '../../docs-assets/mock/version.json';
import ytdlpVersionJson from '../../docs-assets/mock/ytdlp-version.json';

/**
 * The server paths in the mocks start with `/images/`; on GitHub Pages the
 * app lives under a sub-path, so they are made relative to the base href.
 */
function relativeImages<T>(data: T): T {
  return JSON.parse(JSON.stringify(data).replaceAll('"/images/', '"images/'));
}

function trimSlashes(path: string | null | undefined): string {
  return (path ?? '').replace(/^\/+|\/+$/g, '');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Everything the demo "server" knows, kept in memory until the page reloads. */
@Injectable({ providedIn: 'root' })
export class DemoStore {
  settings = relativeImages(settingsJson) as unknown as SettingsModel;
  subscriptions = relativeImages(subscriptionsJson) as unknown as SubscriptionModel[];
  downloads = relativeImages(downloadsJson.items) as unknown as DownloadModel[];
  telegramChats = relativeImages(telegramChatsJson) as unknown as TelegramChatModel[];
  telegramStatus = telegramStatusJson;
  version = versionJson as unknown as VersionModel;
  ytdlpVersion = ytdlpVersionJson;
  pot = potJson;
  nextCheck = nextCheckJson;

  /**
   * The sample file each row really plays, by id. Renaming or moving a file
   * only changes what the row says — the static file stays where it is.
   */
  private readonly _media = new Map<number, string>(this.downloads.map((row) => [row.id, row.filePath ?? '']));
  /** The rows as they came, used as the result of a new download. */
  private readonly _samples = structuredClone(this.downloads);
  private readonly _folders = new Map<string, FolderEntryModel>();
  private _nextId = Math.max(...this.downloads.map((row) => row.id)) + 1;

  constructor() {
    foldersJson.entries
      .filter((entry) => entry.type === 'folder')
      .forEach((entry) => this._folders.set(entry.name, entry as FolderEntryModel));
  }

  nextDownloadId(): number {
    return this._nextId++;
  }

  nextSubscriptionId(): number {
    return Math.max(0, ...this.subscriptions.map((sub) => sub.id ?? 0)) + 1;
  }

  download(id: number): DownloadModel | undefined {
    return this.downloads.find((row) => row.id === id);
  }

  /** URL of the static file behind a row, relative to the base href. */
  mediaUrl(id: number): string {
    const path = this._media.get(id) ?? '';

    return `downloads/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  /**
   * A finished row to stand in for a new download: the sample with the same
   * video id when the URL names one, otherwise any sample of the same type.
   */
  sampleFor(url: string, type: string | null): DownloadModel {
    const byVideo = this._samples.find((row) => row.videoId && url.includes(row.videoId));
    const byType = this._samples.filter((row) => row.type === type);
    const pool = byType.length ? byType : this._samples;

    return structuredClone(byVideo ?? pool[Math.floor(Math.random() * pool.length)]);
  }

  /** Points a new row at the same static file its sample plays. */
  linkMedia(id: number, sample: DownloadModel) {
    this._media.set(id, this._media.get(sample.id) ?? sample.filePath ?? '');
  }

  addFolder(path: string) {
    const parts = trimSlashes(path).split('/').filter(Boolean);

    parts.forEach((name, index) => {
      const full = parts.slice(0, index + 1).join('/');
      if (!this._folders.has(full)) this._folders.set(full, { name, type: 'folder', mount: false });
    });
  }

  /** One level of the "mounted root": the known folders plus wherever a row's file sits. */
  folder(path: string, withFiles: boolean): FolderListingModel | null {
    const wanted = trimSlashes(path);
    const files = this.downloads.map((row) => trimSlashes(row.filePath)).filter(Boolean);

    files.forEach((file) => this.addFolder(dirname(file)));

    if (wanted && !this._folders.has(wanted)) return null;

    const folders = [...this._folders.entries()]
      .filter(([full]) => dirname(full) === wanted)
      .map(([, entry]) => entry)
      .sort((a, b) => a.name.localeCompare(b.name));

    const names = withFiles
      ? [...new Set(files.filter((file) => dirname(file) === wanted).map(basename))].sort((a, b) => a.localeCompare(b))
      : [];

    return {
      path: wanted,
      entries: [...folders, ...names.map((name): FolderEntryModel => ({ name, type: 'file', mount: false }))],
      truncated: false,
    };
  }

  /** Rows the list would show for a search, newest first. */
  visible(name: string | null): DownloadModel[] {
    const search = name?.trim().toLowerCase();

    return this.downloads
      .filter((row) => !row.hidden)
      .filter(
        (row) =>
          !search || [row.title, row.fileName, row.channelName].some((value) => value?.toLowerCase().includes(search)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  }

  info(name: string | null): DownloadInfoModel {
    const info = Object.fromEntries(Object.values(DownloadStatus).map((status) => [status, 0])) as DownloadInfoModel;

    for (const row of this.visible(name)) {
      info.total++;
      info[row.status]++;
    }

    return info;
  }
}
