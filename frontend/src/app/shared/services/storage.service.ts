import { effect, inject, Injectable, signal } from '@angular/core';
import { DefaultFilters, DefaultPaginator, DefaultSettings } from '../constants/defaults.const';
import { DownloadInfoModel, DownloadModel } from '../models/download.model';
import { FilterModel, Nullable, PaginatorModel } from '../models/common.model';
import { ManualDownloadModel } from '../models/main-form.model';
import { NextCheckModel, SubscriptionModel } from '../models/subscription.model';
import { SettingsModel, TelegramChatModel, TelegramStatusModel } from '../models/settings.model';
import { UiConfig } from '../models/ui-config.model';
import { LocalStorage } from './local-storage.service';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private readonly _localStorage = inject(LocalStorage);

  subscriptions = signal<SubscriptionModel[]>([]);
  settings = signal<SettingsModel>(DefaultSettings);
  editingSubscription = signal<Nullable<SubscriptionModel>>(null);
  showForm = signal<boolean>(false);
  nextCheck = signal<Nullable<NextCheckModel>>(null);
  downloads = signal<DownloadModel[]>([]);
  downloadInfo = signal<Nullable<DownloadInfoModel>>(null);
  uiConfig = signal<UiConfig>(this._localStorage.get('uiConfig'));
  filters = signal<FilterModel>(DefaultFilters);
  paginator = signal<PaginatorModel>(this._localStorage.get('paginator'));
  manualDownloadForm = signal<ManualDownloadModel>(this._localStorage.get('manualDownloadForm'));
  telegramChats = signal<TelegramChatModel[]>([]);
  telegramStatus = signal<TelegramStatusModel | null>(null);

  constructor() {
    effect(() => this._localStorage.set('uiConfig', this.uiConfig()));
    effect(() => this._localStorage.set('manualDownloadForm', this.manualDownloadForm()));
    // Only the page size is worth keeping; the page and total belong to this visit.
    effect(() => this._localStorage.set('paginator', { ...DefaultPaginator, limit: this.paginator().limit }));
  }

  upsertDownloads(incoming: DownloadModel[]): void {
    if (!incoming?.length) return;

    this.downloads.update((rows) => {
      const next = [...rows];
      const indexById = new Map(next.map((row, index) => [row.id, index]));
      const added: DownloadModel[] = [];

      for (const download of incoming) {
        const index = indexById.get(download.id);

        if (index === undefined) added.push(download);
        else next[index] = download;
      }

      added.sort((a, b) => b.id - a.id);

      return [...added, ...next];
    });
  }
}
