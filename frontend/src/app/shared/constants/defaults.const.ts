import { BgType, ThemeColors, UiConfig } from '../models/ui-config.model';
import { Codecs, Types, VideoFormats, VideoQuality } from '../models/subscription.model';
import { DownloadStatus } from '../models/download.model';
import { FilterGroupModel, FilterModel, PaginatorModel } from '../models/common.model';
import { ManualDownloadModel } from '../models/main-form.model';
import { SettingsModel } from '../models/settings.model';
import { PollType, SubscriptionModel } from '../models/subscription.model';

export const DefaultSubscription: SubscriptionModel = {
  id: null,
  channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
  channelDescription: 'Test channel',
  color: '#000000',
  groupId: null,
  sortOrder: 0,
  name: null,
  rssUrl: '',
  type: Types.VIDEO,
  codec: Codecs.AUTO,
  format: VideoFormats.AUTO,
  ytdlpArgs: null,
  startFromLast: false,
  downloadShorts: false,
  notifyHA: false,
  notifyTelegram: false,
  webhookOverride: '',
  prefix: '',
  tag: '',
  pollType: PollType.INTERVAL,
  pollInterval: null,
  pollTime: [],
  intervalPeriod: null,
};

export const MockSubscription: SubscriptionModel = {
  id: 1,
  channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
  channelDescription: 'Test channel',
  color: '#000000',
  groupId: null,
  sortOrder: 0,
  name: 'Favorite Channel',
  rssUrl: 'https://youtube.com/rss/url/test',
  type: Types.VIDEO,
  codec: Codecs.AUTO,
  format: VideoFormats.AUTO,
  ytdlpArgs: null,
  enabled: true,
  startFromLast: true,
  downloadShorts: false,
  notifyHA: true,
  notifyTelegram: false,
  pollType: PollType.INTERVAL,
  pollInterval: 30,
  pollTime: null,
  prefix: 'Prefix',
  tag: 'youtube',
  webhookOverride: 'https://homeassistant:8123/api/webhook/-a456-426614174000',
  lastVideoId: 'F43xPrFANw',
  lastCheckedAt: new Date('2024-01-01T10:00:00Z'),
  totalDownloads: 0,
  createdAt: new Date('2024-01-01T10:00:00Z'),
  updatedAt: new Date('2024-06-01T12:00:00Z'),
  intervalPeriod: null,
};

export const DefaultSettings: SettingsModel = {
  enabled: true,
  webhookUrl: null,
  downloadsDir: '/downloads',
  cookiesPath: null,
  ytdlpArgs: null,
  ytdlpConcurrency: 2,
  timeZone: null,
  telegramEnabled: false,
  telegramBotToken: null,
  telegramApiUrl: null,
  telegramKeepFiles: false,
  telegramNoDescription: false,
  notifyDownloadFailed: false,
};

export const DefaultUiConfig: UiConfig = {
  sectionsBg: BgType.GLASS,
  themeColor: ThemeColors.RED,
  enableAnimations: true,
  autoPaste: false,
};

export const DefaultPaginator: PaginatorModel = {
  total: 0,
  /** Zero-based, like MatPaginator's `pageIndex`; the API's 1-based `page` is derived from it. */
  page: 0,
  limit: 5,
};

export const DefaultManualForm: ManualDownloadModel = {
  url: '',
  quality: VideoQuality.BEST,
  type: Types.VIDEO,
  format: VideoFormats.AUTO,
  codec: Codecs.AUTO,
  ytdlpArgs: '',
  prefix: '',
  destinationFolder: '',
  clipStart: '',
  clipEnd: '',
  removeSponsor: false,
  splitChapters: false,
};

export const DefaultFilters: FilterModel = {
  types: [],
  statuses: [],
};

export const DefaultFilterGroups: readonly FilterGroupModel[] = Object.freeze([
  {
    name: 'types',
    filters: Object.values(Types),
  },
  {
    name: 'statuses',
    filters: Object.values(DownloadStatus).filter((status) => status !== DownloadStatus.TOTAL),
  },
]);
