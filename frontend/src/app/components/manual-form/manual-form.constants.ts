import { AudioFormats, Codecs, VideoQuality, Types, VideoFormats } from '@shared/models';

export const TYPE_ICONS = {
  [Types.VIDEO]: {
    fontIcon: 'play_arrow',
    svgIcon: null,
  },
  [Types.AUDIO]: {
    svgIcon: 'audio_note',
    fontIcon: null,
  },
  [Types.THUMBNAIL]: {
    fontIcon: 'image',
    svgIcon: null,
  },
};

export const CODEC_ICONS = {
  [Codecs.AUTO]: 'auto',
  [Codecs.H264]: 'avc',
  [Codecs.AV1]: 'av1',
  [Codecs.VP9]: 'vp9',
  [Codecs.H265]: 'hevc',
};

export const VIDEO_FORMAT_ICONS = {
  [VideoFormats.AUTO]: 'auto',
  [VideoFormats.MP4]: 'mp4',
  [VideoFormats.IOS]: 'ios',
};

export const AUDIO_FORMAT_ICONS = {
  [AudioFormats.M4A]: 'mp4a',
  [AudioFormats.MP3]: 'mp3',
  [AudioFormats.OPUS]: 'opus',
  [AudioFormats.WAV]: 'wav',
  [AudioFormats.FLAC]: 'flac',
};

export const QUALITY_ICONS = {
  [VideoQuality.BEST]: 'good',
  [VideoQuality.UHD]: 'uhd',
  [VideoQuality.QHD]: 'qhd',
  [VideoQuality.FHD]: 'fhd',
  [VideoQuality.HD]: 'hd',
  [VideoQuality.SD]: 'sd',
  [VideoQuality.NHD]: 'nhd',
  [VideoQuality.QVGA]: 'qvga',
  [VideoQuality.WORST]: 'bad',
};
/**
 * Video and audio format names never collide, so one lookup covers the
 * Format select whichever type is active.
 */
export const FORMAT_ICONS: Record<VideoFormats | AudioFormats, string> = {
  ...VIDEO_FORMAT_ICONS,
  ...AUDIO_FORMAT_ICONS,
};
