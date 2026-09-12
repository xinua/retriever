import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/**
 * Horizontal span (in px) the generated wave path covers. The path is clipped by the
 * SVG viewport, so this only has to be wider than the widest container the bar lives in.
 */
const WAVE_SPAN = 4096;

/**
 * Material 3 flattens the wave near both ends of the track: below `FLAT_BELOW` there is
 * not enough room to draw a wave, above `FLAT_ABOVE` the indicator settles into a line.
 */
const FLAT_BELOW = 10;
const FLAT_ABOVE = 95;

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Material 3 Expressive "wavy" linear progress indicator.
 *
 * The active indicator is a travelling wave, separated from the straight inactive track by a
 * gap, with a stop indicator at the end of the track. With `showPlayHead` a vertical playhead
 * is drawn in that gap, marking the end of the wave. Colors can be themed from the outside:
 *
 * ```css
 * rt-progress-bar {
 *   --rt-progress-active-color: var(--mat-sys-tertiary);
 *   --rt-progress-track-color: #333;
 *   --rt-progress-play-head-color: #fff;
 *   --rt-progress-play-head-width: 2px;
 * }
 * ```
 */
@Component({
  selector: 'rt-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  host: {
    role: 'progressbar',
    '[style]': 'styleVars()',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-valuemin]': 'indeterminate() ? null : 0',
    '[attr.aria-valuemax]': 'indeterminate() ? null : 100',
    '[attr.aria-valuenow]': 'indeterminate() ? null : progress()',
  },
  template: `
    <ng-template #wave>
      <svg [attr.height]="trackHeight()" width="100%" aria-hidden="true" focusable="false">
        <g class="amplitude" [style.transform]="'scaleY(' + amplitudeScale() + ')'">
          <path [attr.d]="wavePath()" />
        </g>
      </svg>
    </ng-template>

    <div class="wavy">
      @if (indeterminate()) {
        <!-- <div class="inactive" style="left: 0"></div> -->
        <div class="layer indeterminate-a"><ng-container [ngTemplateOutlet]="wave" /></div>
        <div class="layer indeterminate-b"><ng-container [ngTemplateOutlet]="wave" /></div>
      } @else {
        <div class="inactive" [style.left]="inactiveStart()"></div>
        <div class="stop"></div>
        <div class="layer active" [style.clip-path]="activeClip()"><ng-container [ngTemplateOutlet]="wave" /></div>
        @if (showPlayHead()) {
          <div class="play-head" [style.left]="playHeadStart()"></div>
        }
      }
    </div>
  `,
  styles: `
    :host {
      --rt-progress-active-color: var(--mat-sys-primary, #22c55e);
      --rt-progress-track-color: var(--mat-sys-secondary-container, #4b5563);
      --rt-progress-play-head-color: var(--rt-progress-active-color);
      --rt-progress-play-head-width: var(--rt-thickness);
      --rt-progress-gap: 4px;

      display: block;
      width: 100%;
      height: var(--rt-track-height);
    }

    .wavy {
      position: relative;
      width: 100%;
      height: 100%;
    }

    .layer {
      position: absolute;
      inset: 0;
      color: var(--rt-progress-active-color);
    }

    .active {
      transition: clip-path 0.25s ease-in-out;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }

    .amplitude {
      transform-box: view-box;
      transform-origin: 50% 50%;
      transition: transform 0.4s ease-in-out;
    }

    path {
      fill: none;
      stroke: currentColor;
      stroke-width: var(--rt-thickness);
      stroke-linecap: round;
      /* Keeps the stroke at full thickness while .amplitude scales the wave down. */
      vector-effect: non-scaling-stroke;
      animation: rt-wave-travel var(--rt-wave-duration) linear infinite;
    }

    .inactive {
      position: absolute;
      right: 0;
      top: 50%;
      height: var(--rt-thickness);
      border-radius: 999px;
      background: var(--rt-progress-track-color);
      transform: translateY(-50%);
      transition: left 0.25s ease-in-out;
    }

    .stop {
      position: absolute;
      right: 0;
      top: 50%;
      width: var(--rt-thickness);
      height: var(--rt-thickness);
      border-radius: 50%;
      background: var(--rt-progress-active-color);
      transform: translateY(-50%);
    }

    /*
     * Vertical marker sitting in the gap at the end of the wave. Its position is clamped so the
     * marker stays inside the track once the progress reaches 100%.
     */
    .play-head {
      position: absolute;
      top: 50%;
      width: var(--rt-progress-play-head-width);
      height: 200%;
      border-radius: 999px;
      background: var(--rt-progress-play-head-color);
      transform: translate(-50%, -50%);
      transition: left 0.25s ease-in-out;
    }

    .indeterminate-a {
      animation: rt-indeterminate-a 2s cubic-bezier(0.4, 0, 0.2, 1) infinite backwards;
    }

    .indeterminate-b {
      animation: rt-indeterminate-b 2s cubic-bezier(0.4, 0, 0.2, 1) 1.15s infinite backwards;
    }

    @keyframes rt-wave-travel {
      from {
        transform: translateX(0);
      }
      to {
        transform: translateX(var(--rt-wave-length));
      }
    }

    @keyframes rt-indeterminate-a {
      0% {
        clip-path: inset(0 100% 0 0);
      }
      25% {
        clip-path: inset(0 40% 0 0);
      }
      60% {
        clip-path: inset(0 0 0 30%);
      }
      100% {
        clip-path: inset(0 0 0 100%);
      }
    }

    @keyframes rt-indeterminate-b {
      0% {
        clip-path: inset(0 100% 0 0);
      }
      40% {
        clip-path: inset(0 65% 0 0);
      }
      75% {
        clip-path: inset(0 0 0 55%);
      }
      100% {
        clip-path: inset(0 0 0 100%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      path {
        animation: none;
      }

      .active,
      .inactive,
      .play-head,
      .amplitude {
        transition: none;
      }
    }
  `,
})
export class ProgressBarComponent {
  /** Progress in percent, 0-100. Ignored while `indeterminate` is set. */
  value = input<number>(0);

  /** Draw a vertical playhead at the end of the wave. Ignored while `indeterminate` is set. */
  showPlayHead = input<boolean>(false);

  /** Show the looping indeterminate animation instead of `value`. */
  indeterminate = input<boolean>(false);

  /** Accessible name of the indicator. */
  label = input<string>('');

  /** Stroke thickness of both tracks, in px (M3 default: 3). */
  thickness = input<number>(3);

  /** Distance from the centre line to a wave crest, in px (M3 default: 3). */
  amplitude = input<number>(3);

  /** Length of one full wave, in px (M3 default: 30). */
  waveLength = input<number>(30);

  /** Travel speed of the wave, in wavelengths per second (default: 1.5). */
  speed = input<number>(1.5);

  protected readonly progress = computed(() => Math.min(100, Math.max(0, this.value())));

  /** Height of the SVG viewport: the stroke plus the room the crests need on both sides. */
  protected readonly trackHeight = computed(() => this.thickness() + 2 * this.amplitude());

  protected readonly styleVars = computed(
    () =>
      `--rt-thickness:${this.thickness()}px;` +
      `--rt-wave-length:${this.waveLength()}px;` +
      `--rt-wave-duration:${round(1 / Math.max(this.speed(), 0.001))}s;` +
      `--rt-track-height:${this.trackHeight()}px;`,
  );

  protected readonly activeClip = computed(() => `inset(0 ${round(100 - this.progress())}% 0 0)`);

  protected readonly inactiveStart = computed(() => `calc(${round(this.progress())}% + var(--rt-progress-gap))`);

  /**
   * Centre of the playhead: the middle of the gap that separates the wave from the inactive
   * track, pulled back at the very end so the marker never hangs off the track.
   */
  protected readonly playHeadStart = computed(
    () =>
      `min(calc(${round(this.progress())}% + var(--rt-progress-gap) / 2),` +
      ` calc(100% - var(--rt-progress-play-head-width) / 2))`,
  );

  /**
   * Vertical scale applied to the wave, so it can flatten out at both ends of the track.
   * The flat value is a hair above zero: a `scaleY(0)` matrix is singular and browsers drop
   * the element instead of drawing the flattened line.
   */
  protected readonly amplitudeScale = computed(() => {
    if (this.indeterminate()) return 1;
    const progress = this.progress();
    return progress <= FLAT_BELOW || progress >= FLAT_ABOVE ? 0.001 : 1;
  });

  /**
   * A sine wave approximated with one cubic bézier per half wavelength. The path starts one
   * wavelength before the track so it stays seamless while it travels to the right.
   */
  protected readonly wavePath = computed(() => {
    const waveLength = this.waveLength();
    const half = waveLength / 2;
    const handle = (4 * this.amplitude()) / 3;
    const centerY = this.trackHeight() / 2;
    const halves = Math.ceil((WAVE_SPAN + waveLength) / half);

    let path = `M${-waveLength} ${round(centerY)}`;
    for (let i = 0; i < halves; i++) {
      const crest = round(i % 2 === 0 ? -handle : handle);
      path += `c${round(half / 3)} ${crest} ${round((2 * half) / 3)} ${crest} ${round(half)} 0`;
    }
    return path;
  });
}
