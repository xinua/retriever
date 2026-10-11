import { Injectable } from '@angular/core';
import { catchError, filter, map, Observable, of } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { DownloadModel } from '../models/download.model';
import { TelegramChatModel, TelegramStatusModel } from '../models/settings.model';
import {
  SubscriptionPayload,
  DownloaderStatusPayload,
  DownloadRemovedPayload,
  NextCheckPayload,
  NotificationPayload,
  WebSocketData,
  WebSocketMessageType,
  WsMessage,
} from '../models/websocket.model';

@Injectable({
  providedIn: 'root',
})
export class WsService {
  private readonly _socket: Socket;

  wsMessage$<T>(type: WebSocketMessageType): Observable<T> {
    return new Observable<WsMessage<WebSocketData>>((subscriber) => {
      const handler = (message: WsMessage<WebSocketData>) => subscriber.next(message);

      this._socket.on('message', handler);

      return () => this._socket.off('message', handler);
    }).pipe(
      filter((message) => message.type === type),
      map((message) => message.data as T),
    );
  }

  constructor() {
    this._socket = io({
      path: '/ws',
      transports: ['websocket'],
    });
  }

  downloaderStatus$(): Observable<DownloaderStatusPayload> {
    return this.wsMessage$<DownloaderStatusPayload>('downloader-status').pipe(
      catchError(() => of({ status: false, detail: null }) as Observable<DownloaderStatusPayload>),
    );
  }

  /**
   * Hidden rows are still broadcast — the browser extension follows its own
   * downloads over this socket — but the app never shows them, so they stop
   * here rather than in every list that listens.
   */
  downloadUpdated$(): Observable<DownloadModel> {
    return this.wsMessage$<DownloadModel>('download-updated').pipe(filter((row) => !row.hidden));
  }

  /**
   * Rows that changed together — a playlist expansion queueing hundreds of
   * videos, or a cancel-all clearing them. Sent as one message rather than an
   * event per row, which at 500 downloads would flood every open tab.
   */
  downloadsBatch$(): Observable<DownloadModel[]> {
    return this.wsMessage$<DownloadModel[]>('downloads-batch').pipe(
      map((rows) => rows.filter((row) => !row.hidden)),
      filter((rows) => rows.length > 0),
    );
  }

  downloadRemoved$(): Observable<DownloadRemovedPayload> {
    return this.wsMessage$<DownloadRemovedPayload>('download-removed');
  }

  downloadsCleared$(): Observable<unknown> {
    return this.wsMessage$<unknown>('downloads-cleared');
  }

  nextCheck$(): Observable<NextCheckPayload> {
    return this.wsMessage$<NextCheckPayload>('next-check');
  }

  subscriptionUpdated$(): Observable<SubscriptionPayload> {
    return this.wsMessage$<SubscriptionPayload>('channel-updated');
  }

  telegramStatus$(): Observable<TelegramStatusModel> {
    return this.wsMessage$<TelegramStatusModel>('telegram-status');
  }

  /** The whole chat list, pushed whenever it changes — a /start adds a pending row. */
  telegramChats$(): Observable<TelegramChatModel[]> {
    return this.wsMessage$<TelegramChatModel[]>('telegram-chats');
  }

  closeConnection() {
    this._socket.disconnect();
  }

  notifications$(): Observable<NotificationPayload> {
    return this.wsMessage$<NotificationPayload>('notification');
  }
}
