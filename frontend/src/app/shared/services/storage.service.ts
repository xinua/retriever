import { computed, effect, Injectable, signal } from '@angular/core';
import {
  DefaultFilters,
  DefaultManualForm,
  DefaultPaginator,
  DefaultSettings,
  DefaultUiConfig,
} from '../constants/defaults.const';
import { DownloadInfoModel, DownloadModel } from '../models/download.model';
import { FilterModel, Nullable, PaginatorModel } from '../models/common.model';
import { ManualDownloadModel } from '../models/main-form.model';
import { NextCheckModel, SubscriptionModel } from '../models/subscription.model';
import { SettingsModel, TelegramChatModel, TelegramStatusModel } from '../models/settings.model';
import { UiConfig } from '../models/ui-config.model';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  subscriptions = signal<SubscriptionModel[]>([]);
  settings = signal<SettingsModel>(DefaultSettings);
  editingSubscription = signal<Nullable<SubscriptionModel>>(null);
  showForm = signal<boolean>(false);
  nextCheck = signal<Nullable<NextCheckModel>>(null);
  downloads = signal<DownloadModel[]>([]);
  downloadInfo = signal<Nullable<DownloadInfoModel>>(null);
  uiConfig = signal<UiConfig>(DefaultUiConfig);
  filters = signal<FilterModel>(DefaultFilters);
  paginator = signal<PaginatorModel>(DefaultPaginator);
  manualDownloadForm = signal<ManualDownloadModel>(DefaultManualForm);
  telegramChats = signal<TelegramChatModel[]>([]);
  telegramStatus = signal<TelegramStatusModel | null>(null);

  folders = signal<string[]>([]);

  folderOptions = computed<string[]>(() =>
    [...new Set([...this.folders(), ...this.subscriptions().map(({ tag }) => tag)])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  );

  constructor() {
    this.paginator.set((JSON.parse(localStorage.getItem('paginator')) as PaginatorModel) || DefaultPaginator);
    this.manualDownloadForm.set(
      (JSON.parse(localStorage.getItem('manualDownloadForm')) as ManualDownloadModel) || DefaultManualForm,
    );

    effect(() => {
      localStorage.setItem('manualDownloadForm', JSON.stringify(this.manualDownloadForm()));
      localStorage.setItem('paginator', JSON.stringify({ ...DefaultPaginator, limit: this.paginator().limit }));
    });
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
