import { SnackbarType } from './snackbar.model';
import { SubscriptionModel, NextCheckModel } from './subscription.model';
import { DownloadModel } from './download.model';

export interface WsMessage<T> {
  type: string;
  data: T;
}

export type WebSocketData =
  | NotificationPayload
  | SubscriptionPayload
  | DownloaderStatusPayload
  | DownloadModel
  | DownloadModel[]
  | DownloadRemovedPayload;

export type WebSocketMessageType =
  | 'notification'
  | 'downloader-status'
  | 'next-check'
  | 'channel-updated'
  | 'download-updated'
  | 'downloads-batch'
  | 'download-removed'
  | 'downloads-cleared'
  | 'telegram-status'
  | 'telegram-chats';

export interface NotificationPayload {
  title?: 'notification';
  subtitle?: string;
  message: string;
  type: SnackbarType;
}

export interface SubscriptionPayload {
  channel: SubscriptionModel;
}

export interface DownloaderStatusPayload {
  status: boolean;
  detail: string | null;
}

export interface DownloadRemovedPayload {
  id: number;
}

export type NextCheckPayload = NextCheckModel;
