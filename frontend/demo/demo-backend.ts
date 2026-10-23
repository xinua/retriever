import {
  HttpBackend,
  HttpErrorResponse,
  HttpEvent,
  HttpRequest,
  HttpResponse,
  HttpXhrBackend,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { delay, Observable, of, throwError, timer, mergeMap } from 'rxjs';
import {
  DownloadModel,
  DownloadSource,
  DownloadStatus,
  ManualDownloadRequest,
  ManualDownloadResult,
} from '../src/app/shared/models/download.model';
import { SnackbarType } from '../src/app/shared/models/snackbar.model';
import { SubscriptionModel } from '../src/app/shared/models/subscription.model';
import { DemoSocket } from './demo-socket';
import { DemoStore } from './demo-store';

/** Thrown by a handler to answer with an HTTP error instead of a body. */
class DemoError {
  constructor(
    readonly status: number,
    readonly error: string,
  ) {}
}

interface DemoContext {
  req: HttpRequest<unknown>;
  params: string[];
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

type Handler = (ctx: DemoContext) => unknown;

/** Network-ish latency, so loaders and pending states show up for a moment. */
const LATENCY = 150;

/**
 * Answers `/api/*` from {@link DemoStore} instead of the network, and pushes
 * the websocket messages the real server would send after the same call.
 * Everything else — icons, the extension's version file — goes out as usual.
 */
@Injectable({ providedIn: 'root' })
export class DemoBackend implements HttpBackend {
  private readonly _xhr = inject(HttpXhrBackend);
  private readonly _store = inject(DemoStore);
  private readonly _socket = inject(DemoSocket);
  private readonly _timers = new Map<number, ReturnType<typeof setInterval>>();

  private readonly _routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/version$/, () => this._store.version],
    ['POST', /^\/api\/version\/check$/, () => this._store.version],

    ['GET', /^\/api\/settings$/, () => this._store.settings],
    ['POST', /^\/api\/settings$/, ({ body }) => this._saveSettings(body)],
    [
      'POST',
      /^\/api\/settings\/time-zone$/,
      ({ body }) => this._saveSettings(this._store.settings.timeZone ? {} : { timeZone: body.timeZone }),
    ],
    [
      'POST',
      /^\/api\/settings\/validate-ytdlp$/,
      () => ({ status: true, version: this._store.ytdlpVersion.version, error: null }),
    ],
    ['POST', /^\/api\/settings\/cookies$/, () => this._saveSettings({ cookiesPath: 'cookies.txt' })],
    ['DELETE', /^\/api\/settings\/cookies$/, () => this._saveSettings({ cookiesPath: null })],

    ['GET', /^\/api\/subscriptions$/, () => this._store.subscriptions],
    ['GET', /^\/api\/subscriptions\/(\d+)$/, ({ params }) => this._subscription(+params[0])],
    ['POST', /^\/api\/subscriptions$/, ({ body }) => this._addSubscription(body)],
    ['PUT', /^\/api\/subscriptions\/(\d+)$/, ({ params, body }) => this._updateSubscription(+params[0], body)],
    [
      'PUT',
      /^\/api\/subscriptions\/(\d+)\/avatar$/,
      ({ params, body }) => this._updateSubscription(+params[0], { channelAvatarPath: URL.createObjectURL(body) }),
    ],
    ['DELETE', /^\/api\/subscriptions\/(\d+)$/, ({ params }) => this._deleteSubscription(+params[0])],
    ['GET', /^\/api\/next-check$/, () => this._nextCheck()],

    ['POST', /^\/api\/actions\/run-once-all$/, () => this._scan(this._store.subscriptions)],
    ['POST', /^\/api\/actions\/run-once\/(\d+)$/, ({ params }) => this._scan([this._subscription(+params[0])])],
    ['POST', /^\/api\/actions\/toggle-enabled$/, () => this._toggleEnabled()],
    ['POST', /^\/api\/actions\/send-webhook$/, () => ({ ok: true })],

    ['GET', /^\/api\/ytdlp\/version$/, () => this._store.ytdlpVersion],
    ['GET', /^\/api\/ytdlp\/pot$/, () => this._store.pot],
    ['POST', /^\/api\/ytdlp\/update$/, () => this._updateYtdlp()],

    ['GET', /^\/api\/downloads$/, ({ query }) => this._list(query)],
    ['GET', /^\/api\/downloads\/info$/, ({ query }) => this._store.info(query.get('name'))],
    ['GET', /^\/api\/downloads\/by-watcher\/(\d+)$/, ({ params, query }) => this._byWatcher(+params[0], query)],
    ['POST', /^\/api\/downloads$/, ({ body }) => this._create(body)],
    ['POST', /^\/api\/downloads\/cancel-all$/, () => this._cancelAll()],
    ['POST', /^\/api\/downloads\/clear-finished$/, () => this._clearFinished()],
    ['POST', /^\/api\/downloads\/(\d+)\/retry$/, ({ params }) => this._retry(+params[0])],
    ['POST', /^\/api\/downloads\/(\d+)\/cancel$/, ({ params }) => this._cancel(+params[0])],
    ['DELETE', /^\/api\/downloads\/(\d+)$/, ({ params, query }) => this._remove(+params[0], query.has('withFile'))],
    ['PATCH', /^\/api\/downloads\/(\d+)\/title$/, ({ params, body }) => this._patch(+params[0], { title: body.title })],
    ['PATCH', /^\/api\/downloads\/(\d+)\/file-name$/, ({ params, body }) => this._rename(+params[0], body.fileName)],
    ['PATCH', /^\/api\/downloads\/(\d+)\/path$/, ({ params, body }) => this._setPath(+params[0], body.path)],
    ['POST', /^\/api\/downloads\/(\d+)\/move$/, ({ params, body }) => this._move(+params[0], body.folder)],
    ['POST', /^\/api\/downloads\/(\d+)\/move\/cancel$/, () => ({ ok: true })],
    [
      'PUT',
      /^\/api\/downloads\/(\d+)\/avatar$/,
      ({ params, body }) => this._patch(+params[0], { avatarPath: URL.createObjectURL(body) }),
    ],
    [
      'PUT',
      /^\/api\/downloads\/(\d+)\/poster$/,
      ({ params, body, query }) => ({
        ...this._patch(+params[0], { thumbnailPath: URL.createObjectURL(body) }),
        coverEmbedded: query.get('embed') === 'true' ? true : null,
      }),
    ],
    ['POST', /^\/api\/downloads\/(\d+)\/send-to-ha$/, () => ({ ok: true })],
    [
      'POST',
      /^\/api\/downloads\/(\d+)\/send-to-telegram$/,
      ({ params, body }) => this._sendToTelegram(+params[0], body.chatId),
    ],

    ['GET', /^\/api\/folders$/, ({ query }) => this._folder(query)],

    ['GET', /^\/api\/telegram\/status$/, () => this._store.telegramStatus],
    ['POST', /^\/api\/telegram\/test$/, () => this._testTelegram()],
    ['GET', /^\/api\/telegram\/chats$/, () => this._store.telegramChats],
    ['POST', /^\/api\/telegram\/chats$/, ({ body }) => this._addChat(body.chatId, body.name)],
    ['PATCH', /^\/api\/telegram\/chats\/([^/]+)$/, ({ params, body }) => this._patchChat(params[0], body)],
    [
      'PUT',
      /^\/api\/telegram\/chats\/([^/]+)\/avatar$/,
      ({ params, body }) => this._patchChat(params[0], { avatar: URL.createObjectURL(body) }),
    ],
    ['DELETE', /^\/api\/telegram\/chats\/([^/]+)$/, ({ params }) => this._deleteChat(params[0])],
  ];

  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    const url = new URL(req.urlWithParams, location.origin);

    if (!req.url.startsWith('/api/')) return this._xhr.handle(req);

    const route = this._routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));

    if (!route) {
      console.warn(`[demo] no mock for ${req.method} ${url.pathname}`);
      return this._error(req, new DemoError(404, 'Not available in the demo'));
    }

    const params = route[1].exec(url.pathname)!.slice(1).map(decodeURIComponent);

    try {
      const body = route[2]({ req, params, query: url.searchParams, body: req.body });

      return of(new HttpResponse({ status: 200, url: req.url, body: structuredClone(body ?? null) })).pipe(
        delay(LATENCY),
      );
    } catch (e) {
      if (e instanceof DemoError) return this._error(req, e);
      throw e;
    }
  }

  private _error(req: HttpRequest<unknown>, e: DemoError): Observable<never> {
    return timer(LATENCY).pipe(
      mergeMap(() =>
        throwError(() => new HttpErrorResponse({ status: e.status, url: req.url, error: { error: e.error } })),
      ),
    );
  }

  private _notify(type: SnackbarType, message: string, delayMs = 0, subtitle?: string) {
    this._socket.push('notification', { type, message, subtitle }, delayMs);
  }

  // ---------- settings ----------

  private _saveSettings(patch: object) {
    Object.assign(this._store.settings, patch, { updatedAt: new Date().toISOString() });
    return this._store.settings;
  }

  private _toggleEnabled() {
    this._store.settings.enabled = !this._store.settings.enabled;
    return { enabled: this._store.settings.enabled };
  }

  private _updateYtdlp() {
    const version = this._store.ytdlpVersion.version;

    return {
      ok: true,
      from: version,
      to: version,
      output: `Latest version: ${version}\nyt-dlp is up to date (${version})`,
    };
  }

  // ---------- subscriptions ----------

  private _subscription(id: number): SubscriptionModel {
    const sub = this._store.subscriptions.find((s) => s.id === id);

    if (!sub) throw new DemoError(404, 'Subscription not found');

    return sub;
  }

  private _addSubscription(body: SubscriptionModel) {
    const channelId = /channel_id=([\w-]+)/.exec(body.rssUrl ?? '')?.[1] ?? `demo-${Date.now()}`;
    const sub: SubscriptionModel = {
      ...body,
      id: this._store.nextSubscriptionId(),
      channelId,
      name: body.name || 'New channel',
      channelDescription: null,
      channelAvatarPath: 'images/default.webp',
      enabled: true,
      totalDownloads: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this._store.subscriptions.push(sub);
    this._socket.push('next-check', this._nextCheck(), LATENCY);

    return sub;
  }

  private _updateSubscription(id: number, patch: Partial<SubscriptionModel>) {
    return Object.assign(this._subscription(id), patch, { id, updatedAt: new Date() });
  }

  private _deleteSubscription(id: number) {
    this._store.subscriptions = this._store.subscriptions.filter((sub) => sub.id !== id);
    return { ok: true };
  }

  /** The next poll, always a little in the future so the countdown runs. */
  private _nextCheck() {
    const next = new Date(Date.now() + 17 * 60_000);
    next.setSeconds(0, 0);

    const sub = this._store.subscriptions.find((s) => s.enabled) ?? this._store.subscriptions[0];

    if (!sub) return { ok: false, nextCheckAt: null, subscription: null };

    return { ok: true, nextCheckAt: next.toISOString(), subscription: { id: sub.id, name: sub.name } };
  }

  private _scan(subs: SubscriptionModel[]) {
    subs.forEach((sub, index) => {
      Object.assign(sub, { lastCheckedAt: new Date() });
      this._socket.push('subscription-updated', { subscription: sub }, 800 + index * 300);
    });

    this._notify(SnackbarType.INFO, 'No new videos', 800 + subs.length * 300);

    return { ok: true };
  }

  // ---------- downloads ----------

  private _row(id: number): DownloadModel {
    const row = this._store.download(id);

    if (!row) throw new DemoError(404, 'Not found');

    return row;
  }

  private _list(query: URLSearchParams) {
    const statuses = query.get('statuses')?.split(',') ?? [];
    const types = query.get('types')?.split(',') ?? [];
    const limit = Math.max(1, Number(query.get('limit')) || 50);

    const rows = this._store
      .visible(query.get('name'))
      .filter((row) => !statuses.length || statuses.includes(row.status))
      .filter((row) => !types.length || types.includes(row.type ?? ''));

    const pages = Math.max(1, Math.ceil(rows.length / limit));
    const page = Math.min(Math.max(1, Number(query.get('page')) || 1), pages);

    return { items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages, limit };
  }

  private _byWatcher(watcherId: number, query: URLSearchParams) {
    const sub = this._store.subscriptions.find((s) => s.id === watcherId);
    const statuses = query.get('statuses')?.split(',') ?? [];
    const types = query.get('types')?.split(',') ?? [];

    return (
      this._store
        .visible(null)
        .filter((row) => row.watcherId === watcherId)
        .filter((row) => !sub?.lastVideoId || row.videoId === sub.lastVideoId)
        .filter((row) => !statuses.length || statuses.includes(row.status))
        .find((row) => !types.length || types.includes(row.type ?? '')) ?? null
    );
  }

  /**
   * Queues a row that "downloads" one of the sample files. A subscription's
   * card asks for its last video, so the row takes that video's name and art.
   */
  private _create(request: ManualDownloadRequest): ManualDownloadResult {
    if (!request.url?.trim()) throw new DemoError(400, 'url is required');

    const sample = this._store.sampleFor(request.url, request.type);
    const sub = this._store.subscriptions.find((s) => s.id === request.watcherId);
    const id = this._store.nextDownloadId();

    const row: DownloadModel = {
      ...sample,
      id,
      url: request.url,
      watcherId: request.watcherId ?? null,
      source: request.watcherId ? DownloadSource.WATCHER : DownloadSource.MANUAL,
      quality: request.quality,
      folder: request.folder,
      prefix: request.prefix,
      ytdlpArgs: request.ytdlpArgs,
      clipStart: request.clipStart,
      clipEnd: request.clipEnd,
      removeSponsor: request.removeSponsor,
      splitChapters: request.splitChapters,
      ...(sub && {
        videoId: sub.lastVideoId ?? sample.videoId,
        title: sub.lastVideoTitle ?? sample.title,
        channelId: sub.channelId,
        channelName: sub.name,
        avatarPath: sub.channelAvatarPath ?? sample.avatarPath,
        thumbnailPath: sub.lastVideoThumbnailPath ?? sample.thumbnailPath,
      }),
      createdAt: new Date().toISOString(),
    };

    this._store.linkMedia(id, sample);
    this._store.downloads.push(row);
    this._start(row);

    return {
      ok: true,
      kind: 'video',
      playlistId: null,
      playlistTitle: null,
      queued: 1,
      truncated: false,
      limit: 0,
      downloads: [row],
    };
  }

  /** Walks a row from queued to done, broadcasting each step like the queue does. */
  private _start(row: DownloadModel) {
    this._stop(row.id);
    Object.assign(row, {
      status: DownloadStatus.QUEUED,
      progress: 0,
      speed: null,
      eta: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      fileExists: false,
    });
    this._socket.push('download-updated', row, LATENCY);

    const total = row.totalBytes ?? 20_000_000;

    const timer = setInterval(() => {
      if (row.status === DownloadStatus.QUEUED) {
        Object.assign(row, { status: DownloadStatus.RUNNING, startedAt: new Date().toISOString() });
      } else {
        row.progress = Math.min(100, row.progress + 6 + Math.round(Math.random() * 14));
      }

      const left = (total * (100 - row.progress)) / 100;
      const speed = 2 + Math.random() * 6;

      Object.assign(row, {
        speed: `${speed.toFixed(2)}MiB/s`,
        eta: `00:${String(Math.ceil(left / (speed * 1_048_576))).padStart(2, '0')}`,
      });

      if (row.progress >= 100) {
        this._stop(row.id);
        Object.assign(row, {
          status: DownloadStatus.DONE,
          speed: null,
          eta: null,
          fileExists: true,
          finishedAt: new Date().toISOString(),
        });
        this._notify(SnackbarType.SUCCESS, row.title ?? row.url, 0, row.channelName ?? 'Manual download');
      }

      this._socket.push('download-updated', row);
    }, 600);

    this._timers.set(row.id, timer);
  }

  private _stop(id: number) {
    clearInterval(this._timers.get(id));
    this._timers.delete(id);
  }

  private _retry(id: number) {
    const row = this._row(id);
    this._start(row);
    return row;
  }

  private _cancel(id: number) {
    const row = this._row(id);

    if (row.status !== DownloadStatus.QUEUED && row.status !== DownloadStatus.RUNNING) {
      throw new DemoError(409, 'Download is not cancelable');
    }

    this._stop(id);
    Object.assign(row, {
      status: DownloadStatus.CANCELED,
      speed: null,
      eta: null,
      finishedAt: new Date().toISOString(),
    });
    this._socket.push('download-updated', row, LATENCY);

    return { ok: true };
  }

  private _cancelAll() {
    const active = this._store.downloads.filter(
      (row) => row.status === DownloadStatus.QUEUED || row.status === DownloadStatus.RUNNING,
    );

    active.forEach((row) => {
      this._stop(row.id);
      Object.assign(row, { status: DownloadStatus.CANCELED, speed: null, eta: null });
    });

    if (active.length) this._socket.push('downloads-batch', active, LATENCY);

    return { ok: true, canceled: active.length };
  }

  private _clearFinished() {
    const finished = [DownloadStatus.DONE, DownloadStatus.FAILED, DownloadStatus.CANCELED];

    this._store.downloads = this._store.downloads.filter((row) => !finished.includes(row.status));
    this._socket.push('downloads-cleared', { ok: true }, LATENCY);

    return { ok: true };
  }

  private _remove(id: number, withFile: boolean) {
    this._row(id);
    this._stop(id);
    this._store.downloads = this._store.downloads.filter((row) => row.id !== id);
    this._socket.push('download-removed', { id }, LATENCY);

    return { ok: true, fileDeleted: withFile };
  }

  private _patch(id: number, patch: Partial<DownloadModel>) {
    const row = Object.assign(this._row(id), patch);
    this._socket.push('download-updated', row, LATENCY);
    return row;
  }

  private _rename(id: number, fileName: string) {
    const row = this._row(id);
    const path = row.filePath ?? '';
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const ext = /\.[^./]+$/.exec(path)?.[0] ?? '';

    return this._patch(id, { fileName, filePath: `${folder}${fileName}${ext}` });
  }

  private _setPath(id: number, path: string) {
    if (!path?.trim()) throw new DemoError(400, 'path is required');

    const filePath = path.replace(/^\/+/, '');
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);

    return this._patch(id, { filePath, fileName: name.replace(/\.[^.]+$/, ''), fileExists: true });
  }

  private _move(id: number, folder: string) {
    const row = this._row(id);
    const name = (row.filePath ?? '').slice((row.filePath ?? '').lastIndexOf('/') + 1);
    const target = (folder ?? '').replace(/^\/+|\/+$/g, '');

    this._store.addFolder(target);
    this._notify(SnackbarType.SUCCESS, `Moved to ${target || '/'}`, 600, row.title ?? undefined);

    return this._patch(id, { filePath: target ? `${target}/${name}` : name });
  }

  private _folder(query: URLSearchParams) {
    const listing = this._store.folder(query.get('path') ?? '', query.has('files'));

    if (!listing) throw new DemoError(404, 'Folder not found');

    return listing;
  }

  // ---------- telegram ----------

  private _sendToTelegram(id: number, chatId: string) {
    const row = this._row(id);
    const chat = this._store.telegramChats.find((c) => c.chatId === chatId);

    this._notify(SnackbarType.SUCCESS, row.title ?? row.url, 1500, chat?.name ?? chatId);

    return { ok: true };
  }

  private _testTelegram() {
    const sent = this._store.telegramChats.filter((chat) => chat.status === 'approved' && chat.notify).length;

    return { ok: true, sent, errors: [] };
  }

  private _chat(chatId: string) {
    const chat = this._store.telegramChats.find((c) => c.chatId === chatId);

    if (!chat) throw new DemoError(404, 'Chat not found');

    return chat;
  }

  private _addChat(chatId: string, name: string | null) {
    const now = new Date().toISOString();
    const chat = {
      chatId,
      name,
      avatar: null,
      type: chatId.startsWith('-') ? 'group' : 'private',
      username: null,
      status: 'approved' as const,
      notify: true,
      createdAt: now,
      updatedAt: now,
    };

    this._store.telegramChats = [...this._store.telegramChats.filter((c) => c.chatId !== chatId), chat];

    return chat;
  }

  private _patchChat(chatId: string, patch: object) {
    return Object.assign(this._chat(chatId), patch, { updatedAt: new Date().toISOString() });
  }

  private _deleteChat(chatId: string) {
    this._chat(chatId);
    this._store.telegramChats = this._store.telegramChats.filter((c) => c.chatId !== chatId);
    return { ok: true };
  }
}
