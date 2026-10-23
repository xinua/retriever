import { BgAnimation } from './bg-animation.model';

/** How many drifting soot flakes are dropped into a section. */
const SOOT_COUNT = 4;

/** soot0.png .. soot{SOOT_SPRITES - 1}.png in public/assets/images/animations. */
const SOOT_SPRITES = 2;

/** Embers per row; two rows are chained to keep the flow seamless. */
const EMBER_COUNT = 25;

const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * The moving part of the `fire` section background.
 *
 * The directive owns no timing: every particle is animated by a CSS keyframe
 * in styles.css and this class only decides where a particle sits. Positions
 * are re-rolled on `animationiteration`, i.e. exactly when the particle has
 * faded out or scrolled off, so the jump is never visible - and, unlike the
 * intervals this replaced, the re-rolls stay in step with the animation and
 * stop altogether while the tab is in the background.
 *
 * Everything lives inside a single injected layer, so tearing the effect down
 * is one `remove()` - which also drops the listeners with their nodes.
 */
export class FireBgAnimation implements BgAnimation {
  private readonly _layer: HTMLDivElement;

  constructor(private readonly _host: HTMLElement) {
    this._layer = document.createElement('div');
    this._layer.className = 'fire-bg-layer';
    this._layer.setAttribute('aria-hidden', 'true');

    this._layer.append(
      ...Array.from({ length: SOOT_COUNT }, () => this._createSoot()),
      this._createEmberRow(0),
      this._createEmberRow(1),
    );

    this._host.appendChild(this._layer);
  }

  destroy(): void {
    this._layer.remove();
  }

  private _createSoot(): HTMLImageElement {
    const soot = document.createElement('img');

    soot.className = 'fire-bg-soot';
    soot.alt = '';
    soot.src = `assets/images/animations/soot${randomInt(0, SOOT_SPRITES - 1)}.png`;
    // Per-flake size and timing only - the keyframes stay in the stylesheet.
    soot.style.width = `${randomInt(8, 16)}px`;
    soot.style.animationDelay = `${randomInt(0, 2)}s`;
    soot.style.animationDuration = `${randomInt(2, 7)}s`;

    soot.addEventListener('animationiteration', () => this._placeSoot(soot));
    this._placeSoot(soot);

    return soot;
  }

  /** Soot rises along the left edge, where the glow is strongest. */
  private _placeSoot(soot: HTMLElement): void {
    soot.style.top = `${randomInt(5, 95)}%`;
    soot.style.left = `${randomInt(0, 20)}%`;
  }

  /**
   * Two rows tile the section: row 0 travels from off-screen left to the
   * origin while row 1 travels from the origin to off-screen right, so between
   * them the full width is always covered.
   */
  private _createEmberRow(index: number): HTMLDivElement {
    const row = document.createElement('div');
    const embers = Array.from({ length: EMBER_COUNT }, () => this._createEmber());

    row.className = `fire-bg-embers index-${index}`;
    row.append(...embers);

    row.addEventListener('animationiteration', (event) => {
      // Every ember twinkles on its own animation, and those events bubble.
      if (event.target === row) embers.forEach((ember) => this._placeEmber(ember));
    });

    return row;
  }

  private _createEmber(): HTMLDivElement {
    const ember = document.createElement('div');
    const size = randomInt(2, 5);

    ember.className = 'fire-bg-ember';
    ember.style.width = ember.style.height = `${size}px`;
    ember.style.animationDelay = `${randomInt(0, 20) / 10}s`;
    ember.style.animationDuration = `${randomInt(10, 25) / 10}s`;

    this._placeEmber(ember);

    return ember;
  }

  private _placeEmber(ember: HTMLElement): void {
    ember.style.top = `${randomInt(3, 97)}%`;
    ember.style.left = `${randomInt(0, 100)}%`;
  }
}
