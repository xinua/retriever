import { FormControl } from '@angular/forms';
import { Nullable } from './common.model';

export enum PollType {
  INTERVAL = 'interval',
  TIME = 'time',
}

export enum Types {
  VIDEO = 'video',
  AUDIO = 'audio',
  THUMBNAIL = 'thumbnail',
}

export enum VideoFormats {
  AUTO = 'auto',
  MP4 = 'mp4',
  IOS = 'ios',
}

export enum AudioFormats {
  MP3 = 'mp3',
  M4A = 'm4a',
  OPUS = 'opus',
  WAV = 'wav',
  FLAC = 'flac',
}

export enum Codecs {
  AUTO = 'auto',
  H264 = 'h264',
  H265 = 'h265',
  AV1 = 'av1',
  VP9 = 'vp9',
}

export enum VideoQuality {
  BEST = 'best',
  UHD = '2160p',
  QHD = '1440p',
  FHD = '1080p',
  HD = '720p',
  SD = '480p',
  NHD = '360p',
  QVGA = '240p',
  WORST = 'worst',
}

export enum AudioQuality {
  BEST = 'best',
  HQ = '320kbps',
  MQ = '192kbps',
  LQ = '128kbps',
}

export interface IntervalPeriodModel {
  start: Nullable<Date>;
  end: Nullable<Date>;
}

/** Hours of the day (0-24) the subscription is polled between. `null` — and the full span — mean all day. */
export interface IntervalRangeModel {
  start: number;
  end: number;
}

export interface SubscriptionModel {
  id: Nullable<number>;
  channelId: string;
  channelDescription: Nullable<string>;
  groupId: Nullable<SubscriptionGroupModel['id']>;
  group?: Nullable<SubscriptionGroupModel>;
  sortOrder?: Nullable<number>;
  name: Nullable<string>;
  rssUrl: string;
  type: Types;
  color: Nullable<string>;
  format: VideoFormats | AudioFormats;
  codec: Codecs;
  splitChapters?: Nullable<boolean>;
  removeSponsors?: Nullable<boolean>;
  ytdlpArgs: Nullable<string>;
  enabled?: boolean;
  startFromLast: boolean;
  downloadShorts: boolean;
  notifyHA: boolean;
  intervalPeriod: Nullable<IntervalRangeModel>;
  pollType: PollType;
  pollInterval: Nullable<number>;
  pollTime: Nullable<string[]>;
  pollOnce?: Nullable<boolean>;
  prefix: Nullable<string>;
  tag: Nullable<string>;
  webhookOverride: Nullable<string>;
  channelAvatarPath?: Nullable<string>;
  lastVideoThumbnailPath?: Nullable<string>;
  lastVideoId?: Nullable<string>;
  lastVideoTitle?: Nullable<string>;
  lastVideoDescription?: Nullable<string>;
  lastCheckedAt?: Date;
  lastCaptureAt?: Date;
  nextCheckAt?: Date;
  totalDownloads?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ChannelFormModel {
  id: FormControl<SubscriptionModel['id']>;
  name: FormControl<SubscriptionModel['name']>;
  rssUrl: FormControl<SubscriptionModel['rssUrl']>;
  type: FormControl<SubscriptionModel['type']>;
  format: FormControl<SubscriptionModel['format']>;
  codec?: FormControl<SubscriptionModel['codec']>;
  ytdlpArgs: FormControl<SubscriptionModel['ytdlpArgs']>;
  startFromLast: FormControl<SubscriptionModel['startFromLast']>;
  downloadShorts: FormControl<SubscriptionModel['downloadShorts']>;
  notifyHA: FormControl<SubscriptionModel['notifyHA']>;
  webhookOverride: FormControl<SubscriptionModel['webhookOverride']>;
  prefix: FormControl<SubscriptionModel['prefix']>;
  tag: FormControl<SubscriptionModel['tag']>;
  pollType: FormControl<SubscriptionModel['pollType']>;
  pollInterval: FormControl<SubscriptionModel['pollInterval']>;
  pollTime: FormControl<string[]>;
  splitChapters: FormControl<SubscriptionModel['splitChapters']>;
  removeSponsors: FormControl<SubscriptionModel['removeSponsors']>;
  pollOnce: FormControl<SubscriptionModel['pollOnce']>;
  intervalPeriod: FormControl<SubscriptionModel['intervalPeriod']>;
}

export type NextCheckModel = {
  ok: boolean;
  nextCheckAt: string;
  channel: {
    id: number;
    name: string;
  };
};

export interface SubscriptionGroupModel {
  id: Nullable<number>;
  name: Nullable<string>;
  sortOrder?: Nullable<number>;
  color?: Nullable<string>;
  icon?: Nullable<string>;
  createdAt?: Date;
  updatedAt?: Date;
}
