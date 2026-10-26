import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ClickAction, ClickEvent, DoubleClick } from '../../directives/click';
import { LongPress } from '../../directives/long-press';
import { AudioPlayer } from '../audio-player/audio-player';
import { PlayerSize } from '../audio-player/audio-player.model';
import { MEDIA_GESTURE_SIZES, PLAY_PAUSE_FLASH, SEEK_FEEDBACK, SEEK_STEP } from './media-gestures.const';
import { PlayPauseFlash, PlayPauseIcon, SeekDirection } from './media-gestures.model';

/**
 * The gesture layer of an audio poster: tap to play or pause, double tap a side to seek, hold to close.
 * It owns the feedback those gestures flash over the poster, so every player in the app reads the same way.
 * It covers the poster and stays under the player bar, leaving the bar's own controls to it.
 */
@Component({
  selector: 'rt-media-gestures',
  imports: [MatIcon, LongPress, DoubleClick],
  templateUrl: './media-gestures.html',
  styleUrl: './media-gestures.css',
})
export class MediaGestures {
  /** The player the gestures drive. */
  player = input<AudioPlayer | null>(null);
  playerSize = input<PlayerSize>('md');

  /** Asks the host to stop playback and show its poster again. */
  closed = output<void>();

  readonly seekStep = SEEK_STEP;
  readonly size = computed(() => MEDIA_GESTURE_SIZES[this.playerSize()]);
  readonly seekDirection = signal<SeekDirection | null>(null);
  readonly seekTotalTime = signal(0);
  readonly playPauseFlash = signal<PlayPauseFlash | null>(null);

  private _seekTimeout?: ReturnType<typeof setTimeout>;
  private _flashTimeout?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this._seekTimeout);
      clearTimeout(this._flashTimeout);
    });
  }

  handleClick({ event, action }: ClickEvent) {
    const player = this.player();
    if (!player) return;

    if (action === ClickAction.DOUBLE) {
      this._seek(event, player);
      return;
    }

    // A tap in the middle of a run of double taps belongs to the seek, not to play/pause.
    if (this.seekDirection()) return;

    this._flashPlayPause(player.togglePlayPause() ? 'play_arrow' : 'pause');
  }

  private _seek(event: MouseEvent, player: AudioPlayer) {
    const direction = this._getDirection(event);

    this._showSeek(direction);
    player.seekBy(direction === 'left' ? -SEEK_STEP : SEEK_STEP);
  }

  /** Seeks in the half of the poster that was tapped. */
  private _getDirection(event: MouseEvent): SeekDirection {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = (event.clientX - rect.left) / rect.width;

    return relX < 0.5 ? 'left' : 'right';
  }

  /** Taps in the same direction add up, so the indicator reads as one jump of 10s, 20s, 30s... */
  private _showSeek(direction: SeekDirection) {
    if (!this.seekDirection() || this.seekDirection() === direction) {
      this.seekTotalTime.update((total) => total + SEEK_STEP);
    } else {
      this.seekTotalTime.set(SEEK_STEP);
    }

    this.seekDirection.set(direction);
    clearTimeout(this._seekTimeout);

    this._seekTimeout = setTimeout(() => {
      this.seekDirection.set(null);
      this.seekTotalTime.set(0);
    }, SEEK_FEEDBACK);
  }

  /** Flashes the state playback switched to, YouTube style. */
  private _flashPlayPause(icon: PlayPauseIcon) {
    clearTimeout(this._flashTimeout);

    // A fresh key on every tap restarts the animation even when the icon itself does not change.
    this.playPauseFlash.update((flash) => ({ icon, key: (flash?.key ?? 0) + 1 }));

    this._flashTimeout = setTimeout(() => this.playPauseFlash.set(null), PLAY_PAUSE_FLASH);
  }
}
