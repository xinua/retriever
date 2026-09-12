import { AudioFormats, Codecs, DownloadStatus, HomeSection, VideoFormats } from '@shared/models';

export const CodecLabels: Record<Codecs, string> = {
  [Codecs.AUTO]: 'Auto',
  [Codecs.H264]: 'H.264',
  [Codecs.H265]: 'H.265',
  [Codecs.AV1]: 'AV1',
  [Codecs.VP9]: 'VP9',
};

export const VideoFormatLabels: Record<VideoFormats, string> = {
  [VideoFormats.AUTO]: 'Auto',
  [VideoFormats.MP4]: 'MP4',
  [VideoFormats.IOS]: 'iOS',
};

export const AudioFormatLabels: Record<AudioFormats, string> = {
  [AudioFormats.M4A]: 'M4A',
  [AudioFormats.MP3]: 'MP3',
  [AudioFormats.OPUS]: 'OPUS',
  [AudioFormats.WAV]: 'WAV',
  [AudioFormats.FLAC]: 'FLAC',
};

export const DownloadStatusLabels: Record<DownloadStatus, string> = {
  [DownloadStatus.TOTAL]: 'Total',
  [DownloadStatus.QUEUED]: 'Queued',
  [DownloadStatus.RUNNING]: 'Downloading',
  [DownloadStatus.DONE]: 'Done',
  [DownloadStatus.FAILED]: 'Failed',
  [DownloadStatus.CANCELED]: 'Canceled',
};

export const SectionLabels: Record<HomeSection, string> = {
  [HomeSection.SUBSCRIPTIONS]: 'Subscriptions',
  [HomeSection.DOWNLOADS]: 'Downloads',
};
