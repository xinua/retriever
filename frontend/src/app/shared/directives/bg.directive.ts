import { DestroyRef, Directive, effect, ElementRef, HostBinding, inject } from '@angular/core';
import { StorageService } from '../services/storage.service';
import { BgType } from '../models/ui-config.model';
import { BgAnimation } from './bg-animation.model';
import { FireBgAnimation } from './fire-bg.animation';
import { RainBgAnimation } from './rain-bg.animation';
import { SnowBgAnimation } from './snow-bg.animation';
import { StarsBgAnimation } from './stars-bg.animation';
import { MatrixBgAnimation } from './matrix-bg.animation';

@Directive({
  selector: '[rtBg]',
})
export class BgDirective {
  private readonly _config = inject(StorageService).uiConfig;
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Set only for the backgrounds that need particles in the DOM. */
  private _animation: BgAnimation | null = null;

  /** The backgrounds a class alone cannot express; the rest are class-only. */
  private _bgAnimationMap: Partial<Record<BgType, (host: HTMLElement) => BgAnimation>> = {
    [BgType.FIRE]: (host) => new FireBgAnimation(host),
    [BgType.RAIN]: (host) => new RainBgAnimation(host),
    [BgType.SNOW]: (host) => new SnowBgAnimation(host),
    [BgType.STARS]: (host) => new StarsBgAnimation(host),
    [BgType.MATRIX]: (host) => new MatrixBgAnimation(host),
  };

  private _bgClassMap: Record<BgType, string> = {
    dotted: 'dotted-bg px-4 py-8',
    striped:
      'px-4 py-8 border-x border-x-(--pattern-fg) bg-[image:repeating-linear-gradient(315deg,_var(--pattern-fg)_0,_var(--pattern-fg)_1px,_transparent_0,_transparent_50%)] bg-[size:10px_10px] bg-fixed [--pattern-fg:var(--color-gray-950)]/5 dark:[--pattern-fg:var(--color-white)]/10',
    glass: 'glass-bg px-4 py-8',
    gradient: 'gradient-bg px-4 py-8',
    fire: 'fire-bg px-4 py-8',
    stars: 'stars-bg px-4 py-8',
    snow: 'snow-bg px-4 py-8',
    rain: 'rain-bg px-4 py-8',
    matrix: 'matrix-bg px-4 py-8',
    none: '',
  };

  @HostBinding('class')
  get bgClass() {
    return this._bgClassMap[this._config().sectionsBg];
  }

  constructor() {
    // Particles are built here rather than in the template so a section only
    // pays for them while that background is actually selected - switching away
    // in the settings dialog takes them straight back out of the DOM.
    effect(() => this._syncAnimation(this._config().sectionsBg));

    inject(DestroyRef).onDestroy(() => this._animation?.destroy());
  }

  private _syncAnimation(bg: BgType): void {
    this._animation?.destroy();
    this._animation = this._bgAnimationMap[bg]?.(this._host.nativeElement) ?? null;
  }
}
