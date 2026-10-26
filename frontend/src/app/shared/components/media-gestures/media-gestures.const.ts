import { PlayerSize } from '../audio-player/audio-player.model';
import { MediaGestureSize } from './media-gestures.model';

/** Seconds a double tap jumps. */
export const SEEK_STEP = 10;

/** How long the seek indicator and the play/pause icon stay on screen. Keep the flash in sync with `pop-fade`. */
export const SEEK_FEEDBACK = 1000;
export const PLAY_PAUSE_FLASH = 1300;

/** The feedback scales with the player it belongs to, the same sizes the audio bar uses. */
export const MEDIA_GESTURE_SIZES: Record<PlayerSize, MediaGestureSize> = {
  xs: {
    flashIcon: 48,
    flashPadding: 8,
    barOffset: 25,
    seekInset: 40,
  },
  md: {
    flashIcon: 56,
    flashPadding: 10,
    barOffset: 32,
    seekInset: 48,
  },
  lg: {
    flashIcon: 72,
    flashPadding: 12,
    barOffset: 40,
    seekInset: 64,
  },
};
