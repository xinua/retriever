import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, tap } from 'rxjs';
import { webhookExamplePayload } from '../components/webhook-snackbar/webhook-snackbar.constants';
import { DefaultSettings, DefaultUiConfig } from '../constants';
import {
  FoldersModel,
  SubscriptionModel,
  DownloadInfoModel,
  DownloadModel,
  DownloadsPageModel,
  DownloadStatus,
  ManualDownloadRequest,
  ManualDownloadResult,
  NextCheckModel,
  PotStatusModel,
  UiConfig,
  YtdlpStatusModel,
  YtdlpUpdateModel,
} from '../models';
import { StorageService } from './storage.service';
import { SettingsModel } from '../../shared';

@Injectable({
  providedIn: 'root',
})
export class HttpService {
  private readonly _http = inject(HttpClient);
  private readonly _storage = inject(StorageService);

  getError(): Observable<void> {
    return this._http.get<void>('/error').pipe(
      catchError(async () => {
        throw new Error('Test error');
      }),
    );
  }

  getSettings(): Observable<SettingsModel> {
    return this._http.get<SettingsModel>('/api/settings').pipe(
      tap((settings) => this._storage.settings.set(settings)),
      catchError(async () => DefaultSettings),
    );
  }

  saveSettings(settings: SettingsModel): Observable<SettingsModel> {
    return this._http
      .post<SettingsModel>('/api/settings', settings)
      .pipe(tap((settings) => this._storage.settings.set(settings)));
  }

  getUiConfig(): Observable<UiConfig> {
    return this._http.get<UiConfig>('/api/ui-config').pipe(
      tap((uiConfig) => this._storage.uiConfig.set(uiConfig)),
      catchError(async () => DefaultUiConfig),
    );
  }

  getSubscriptions(): Observable<SubscriptionModel[]> {
    return this._http.get<SubscriptionModel[]>('/api/channels').pipe(
      tap((channels) => this._storage.subscriptions.set(channels)),
      catchError(async () => []),
    );
  }

  getSubscription(id: number): Observable<SubscriptionModel | null> {
    return this._http.get<SubscriptionModel>(`/api/channels/${id}`).pipe(
      tap((subscription) => {
        if (this._storage.subscriptions()?.length) {
          this._storage.subscriptions.update((subscriptions) =>
            subscriptions.map((c) => (c.id === subscription.id ? subscription : c)),
          );
        } else {
          this._storage.subscriptions.set([subscription]);
        }
      }),
      catchError(async () => null),
    );
  }

  getNextCheck(): Observable<NextCheckModel> {
    return this._http.get<NextCheckModel>('/api/next-check').pipe(
      tap((nextCheck) => this._storage.nextCheck.set(nextCheck)),
      catchError(async () => ({ ok: false, nextCheckAt: null, channel: null })),
    );
  }

  addSubscription(subscription: SubscriptionModel): Observable<SubscriptionModel> {
    return this._http.post<SubscriptionModel>('/api/channels', { ...subscription, url: subscription.rssUrl });
  }

  updateSubscription(subscription: SubscriptionModel): Observable<SubscriptionModel> {
    return this._http.put<SubscriptionModel>(`/api/channels/${subscription.id}`, subscription);
  }

  deleteSubscription(id: number): Observable<void> {
    return this._http.delete<void>(`/api/channels/${id}`);
  }

  runOnceAll(): Observable<{ ok: boolean }> {
    return this._http.post<{ ok: boolean }>(`/api/actions/run-once-all`, {});
  }

  scanSubscription(id: number): Observable<void> {
    return this._http.post<void>(`/api/actions/run-once/${id}`, {});
  }

  toggleEnabled(): Observable<{ enabled: boolean }> {
    return this._http.post<{ enabled: boolean }>(`/api/actions/toggle-enabled`, {});
  }

  validateYtdlp(downloadsDir?: string, cookiesPath?: string): Observable<YtdlpStatusModel> {
    return this._http.post<YtdlpStatusModel>(`/api/settings/validate-ytdlp`, { downloadsDir, cookiesPath });
  }

  getYtdlpVersion(): Observable<{ version: string | null; available: boolean }> {
    return this._http.get<{ version: string | null; available: boolean }>('/api/ytdlp/version');
  }

  getPotStatus(): Observable<PotStatusModel> {
    return this._http.get<PotStatusModel>('/api/ytdlp/pot');
  }

  updateYtdlp(): Observable<YtdlpUpdateModel> {
    return this._http.post<YtdlpUpdateModel>('/api/ytdlp/update', {});
  }

  /**
   * One page of history. Paging is server side — the table grows without
   * bound, so the page the list shows is the only part worth transferring.
   * The rows land in storage; the envelope is returned so the caller can size
   * its paginator from `total`/`pages`.
   */
  getDownloads(page = 1, limit = 50, statuses: DownloadStatus[] = []): Observable<DownloadsPageModel> {
    // A caller with no filter selected passes [null]; sending `statuses=null`
    // would be a value the server has to recognise as junk, so drop the
    // parameter entirely instead.
    const wanted = statuses.filter(Boolean).join(',');
    const filter = wanted ? `&statuses=${encodeURIComponent(wanted)}` : '';

    return this._http.get<DownloadsPageModel>(`/api/downloads?page=${page}&limit=${limit}${filter}`).pipe(
      tap((result) => this._storage.downloads.set(result.items)),
      catchError(async () => ({ items: [], total: 0, page, pages: 1, limit })),
    );
  }

  /**
   * The newest download a watcher produced, optionally narrowed to some
   * statuses. 404 when the watcher has none, so callers should expect an error.
   */
  getDownloadByWatcher(watcherId: number, statuses: DownloadStatus[] = []): Observable<DownloadModel> {
    const wanted = statuses.filter(Boolean).join(',');
    const filter = wanted ? `?statuses=${encodeURIComponent(wanted)}` : '';

    return this._http.get<DownloadModel>(`/api/downloads/by-watcher/${watcherId}${filter}`);
  }

  getDownloadsInfo(): Observable<DownloadInfoModel> {
    return this._http.get<DownloadInfoModel>(`/api/downloads/info`);
  }

  /**
   * Queues an ad-hoc download. A playlist or channel URL is expanded server
   * side, so one call can come back with many rows.
   */
  createDownload(request: ManualDownloadRequest): Observable<ManualDownloadResult> {
    return this._http.post<ManualDownloadResult>('/api/downloads', request);
  }

  searchDownloads(query: string, limit = 5, page = 1): Observable<DownloadsPageModel> {
    return this._http.get<DownloadsPageModel>(`/api/downloads/search?name=${query}&page=${page}&limit=${limit}`).pipe(
      tap((result) => this._storage.downloads.set(result.items)),
      catchError(async () => ({ items: [], total: 0, page: 1, pages: 1, limit: 50 })),
    );
  }

  /**
   * URL that streams a finished file back as an attachment. Deliberately not
   * an HttpClient call: fetching it would buffer the whole file — often
   * hundreds of megabytes — into memory before the user could save it. Point
   * the browser at this instead and its own download manager handles it.
   */
  downloadFileUrl(id: number): string {
    return `/api/downloads/${id}/file`;
  }

  /**
   * The same bytes as downloadFileUrl, asked for as `inline` so the browser
   * plays them in a media element instead of offering to save them. The
   * endpoint honours Range requests, which is what lets the player seek.
   */
  streamFileUrl(id: number): string {
    return `/api/downloads/${id}/file?inline=1`;
  }

  retryDownload(id: number): Observable<DownloadModel> {
    return this._http.post<DownloadModel>(`/api/downloads/${id}/retry`, {});
  }

  cancelDownload(id: number): Observable<{ ok: boolean }> {
    return this._http.post<{ ok: boolean }>(`/api/downloads/${id}/cancel`, {});
  }

  deleteDownload(id: number): Observable<{ ok: boolean }> {
    return this._http.delete<{ ok: boolean }>(`/api/downloads/${id}`);
  }

  /** Emergency stop — cancels every queued and running download at once. */
  cancelAllDownloads(): Observable<{ ok: boolean; canceled: number }> {
    return this._http.post<{ ok: boolean; canceled: number }>(`/api/downloads/cancel-all`, {});
  }

  clearFinishedDownloads(): Observable<{ ok: boolean }> {
    return this._http.post<{ ok: boolean }>(`/api/downloads/clear-finished`, {});
  }

  sendWebhook(url: string, body: object = webhookExamplePayload()): Observable<{ ok: boolean }> {
    return this._http.post<{ ok: boolean }>(`/api/actions/send-webhook`, { url, body });
  }

  saveUiConfig(patch: Partial<UiConfig>): Observable<UiConfig> {
    return this._http.post<UiConfig>('/api/ui-config', patch);
  }

  /**
   * The folders that already exist inside the downloads root. Read from disk
   * rather than derived from the saved subscriptions, so folders created by
   * hand or by a manual download are offered by the autocompletes too.
   */
  getFolders(): Observable<FoldersModel> {
    return this._http.get<FoldersModel>('/api/folders').pipe(
      tap(({ folders }) => this._storage.folders.set(folders)),
      catchError(async () => ({ root: '', folders: [] })),
    );
  }
}
