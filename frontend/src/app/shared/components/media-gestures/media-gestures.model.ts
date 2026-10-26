export type SeekDirection = 'left' | 'right';

export type PlayPauseIcon = 'play_arrow' | 'pause';

/** The icon flashed after a toggle. `key` changes on every tap, so the animation replays. */
export interface PlayPauseFlash {
  icon: PlayPauseIcon;
  key: number;
}

export interface MediaGestureSize {
  /** Side of the flashed play/pause icon. */
  flashIcon: number;
  /** Padding of the circle around it. */
  flashPadding: number;
  /** How far the feedback floats above the player bar. */
  barOffset: number;
  /** Distance of the seek indicator from the edge it points at. */
  seekInset: number;
}
