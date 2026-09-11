import { AudioPlayerSize, PlayerSize } from './audio-player.model';

export const AUDIO_PLAYER_SIZES: Record<PlayerSize, AudioPlayerSize> = {
  xs: {
    btnSize: 24,
    iconSize: 14,
    amplitude: 2,
    waveLength: 20,
  },
  md: {
    btnSize: 30,
    iconSize: 20,
    amplitude: 3,
    waveLength: 30,
  },
  lg: {
    btnSize: 32,
    iconSize: 24,
    amplitude: 3,
    waveLength: 30,
  },
};
