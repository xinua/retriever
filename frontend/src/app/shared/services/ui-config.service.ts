import { DOCUMENT, effect, inject, Injectable } from '@angular/core';
import { UiConfig } from '../models';
import { StorageService } from './storage.service';

/**
 * Mirrors the UI config onto the <html> element, where the stylesheets can see
 * it: `data-theme` selects one of the pre-generated Material palettes in
 * material-theme.scss, `data-animations` gates the scroll-in transitions in
 * styles.css.
 *
 * Doing it with attributes rather than inline styles keeps every colour
 * decision in the stylesheet - the service only ever writes which theme is
 * active, never what that theme looks like.
 */
@Injectable({
  providedIn: 'root',
})
export class UiConfigService {
  private readonly _storage = inject(StorageService);
  private readonly _root = inject(DOCUMENT).documentElement;

  readonly config = this._storage.uiConfig.asReadonly();

  constructor() {
    // Applied once up front as well as on change: an effect first flushes
    // during the initial change detection run, which is late enough to show a
    // frame of the default palette before the configured one lands.
    this._apply(this._storage.uiConfig());

    effect(() => this._apply(this._storage.uiConfig()));
  }

  update(patch: Partial<UiConfig>): void {
    this._storage.uiConfig.update((config) => ({ ...config, ...patch }));
  }

  private _apply(config: UiConfig): void {
    this._root.setAttribute('data-theme', config.themeColor);
    this._root.setAttribute('data-animations', config.enableAnimations ? 'on' : 'off');
    this._root.querySelector('link[rel="icon"]')?.setAttribute('href', `favicon-${config.themeColor}.ico`);
    this._root.querySelector('link[rel="shortcut icon"]')?.setAttribute('href', `favicon-${config.themeColor}.ico`);
  }
}
