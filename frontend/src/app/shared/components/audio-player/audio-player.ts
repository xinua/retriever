import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ProgressBarComponent } from '../progress-bar/progress-bar.component';
import { TimeFormat, TimePipe } from '../../pipes/time.pipe';
import { AUDIO_PLAYER_SIZES } from './audio-player.const';
import { PlayerSize } from './audio-player.model';

@Component({
  selector: 'rt-audio-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProgressBarComponent, MatIcon, MatButtonModule, TimePipe],
  templateUrl: './audio-player.html',
  styleUrl: './audio-player.css',
})
export class AudioPlayer {
  audioUrl = input<string>();
  duration = input<number, number>(0, { transform: (value) => Math.round(value) || 0 });
  playerSize = input<PlayerSize>('md');
  gotError = output<ErrorEvent>();

  private readonly nativePlayer = viewChild.required<ElementRef<HTMLAudioElement>>('nativePlayer');

  readonly isPlaying = signal(false);
  readonly isMuted = signal(false);
  readonly size = computed(() => AUDIO_PLAYER_SIZES[this.playerSize()]);

  /** Playback position in seconds. While the user drags the slider it mirrors the slider instead. */
  readonly currentTime = signal(0);

  private readonly mediaDuration = signal(0);

  /** True from the first slider `input` until the seek is committed, so `timeupdate` cannot snap the thumb back. */
  private readonly isSeeking = signal(false);

  readonly timeFormat = TimeFormat;

  readonly totalDuration = computed(() => this.mediaDuration() || this.duration());

  /** Progress in percent, 0-100, for the visual bar. */
  readonly progress = computed(() => {
    const total = this.totalDuration();
    return total > 0 ? Math.min(100, (this.currentTime() / total) * 100) : 0;
  });

  /** Whole seconds for the time label (the pipe expects integers). */
  readonly currentTimeValue = computed(() => Math.round(this.currentTime()));
  readonly durationValue = computed(() => Math.round(this.totalDuration()));

  private get audio(): HTMLAudioElement {
    return this.nativePlayer().nativeElement;
  }

  togglePlayPause() {
    const audio = this.audio;
    if (audio.paused) {
      audio.play().catch(() => this.isPlaying.set(false));
    } else {
      audio.pause();
    }
  }

  toggleMute() {
    this.isMuted.update((muted) => !muted);
  }

  onSeekInput(event: Event) {
    this.isSeeking.set(true);
    this.currentTime.set(this._sliderSeconds(event));
  }

  onSeekCommit(event: Event) {
    const seconds = this._sliderSeconds(event);
    this.isSeeking.set(false);
    this.currentTime.set(seconds);

    if (Number.isFinite(seconds)) this.audio.currentTime = seconds;
  }

  onTimeUpdate() {
    if (!this.isSeeking()) this.currentTime.set(this.audio.currentTime);
  }

  onDurationChange() {
    const { duration } = this.audio;
    this.mediaDuration.set(Number.isFinite(duration) ? duration : 0);
  }

  onEmptied() {
    this.isSeeking.set(false);
    this.currentTime.set(0);
    this.mediaDuration.set(0);
  }

  private _sliderSeconds(event: Event): number {
    return (event.target as HTMLInputElement).valueAsNumber;
  }
}
