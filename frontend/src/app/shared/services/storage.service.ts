import { computed, effect, Injectable, signal } from '@angular/core';
import {
  DefaultManualForm,
  DefaultSettings,
  DefaultUiConfig,
  DefaultFilters,
  DefaultPaginator,
} from '../constants/defaults.const';
import {
  SubscriptionModel,
  DownloadModel,
  DownloadStatus,
  ManualDownloadModel,
  NextCheckModel,
  Nullable,
  SettingsModel,
  UiConfig,
  PaginatorModel,
} from '../models';

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
  uiConfig = signal<UiConfig>(DefaultUiConfig);
  filters = signal<DownloadStatus[]>(DefaultFilters);
  paginator = signal<PaginatorModel>(DefaultPaginator);
  manualDownloadForm = signal<ManualDownloadModel>(DefaultManualForm);

  /** Folders that exist on disk under the downloads root — see /api/folders. */
  folders = signal<string[]>([]);

  /**
   * What the folder autocompletes offer. Disk is the source of truth, but a
   * subscription's tag is a folder the user has already committed to even
   * when nothing has been downloaded into it yet, so both are offered.
   */
  folderOptions = computed<string[]>(() =>
    [...new Set([...this.folders(), ...this.subscriptions().map(({ tag }) => tag)])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  );

  constructor() {
    this.filters.set((JSON.parse(localStorage.getItem('downloadsFilters')) as DownloadStatus[]) || DefaultFilters);
    this.paginator.set((JSON.parse(localStorage.getItem('paginator')) as PaginatorModel) || DefaultPaginator);
    this.manualDownloadForm.set(
      (JSON.parse(localStorage.getItem('manualDownloadForm')) as ManualDownloadModel) || DefaultManualForm,
    );

    effect(() => {
      localStorage.setItem('downloadsFilters', JSON.stringify(this.filters()));
      localStorage.setItem('manualDownloadForm', JSON.stringify(this.manualDownloadForm()));
      localStorage.setItem('paginator', JSON.stringify({ ...DefaultPaginator, limit: this.paginator().limit }));
    });
  }

  /**
   * Merges download rows in by id. The same row legitimately arrives more than
   * once — the response to a manual download and the websocket broadcast that
   * announces it race each other — so adding blindly would duplicate the card.
   * Existing rows keep their position; genuinely new ones go on top, newest
   * first, matching the order the list is loaded in.
   */
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
