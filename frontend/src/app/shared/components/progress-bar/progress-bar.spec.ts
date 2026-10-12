import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProgressBarComponent } from './progress-bar.component';

describe('ProgressBarComponent', () => {
  let fixture: ComponentFixture<ProgressBarComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressBarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProgressBarComponent);
    host = fixture.nativeElement;
  });

  async function render(inputs: Partial<Record<keyof ProgressBarComponent, unknown>> = {}) {
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    await fixture.whenStable();
  }

  const query = <T extends Element = HTMLElement>(selector: string): T | null => host.querySelector<T>(selector);
  const queryAll = (selector: string) => host.querySelectorAll(selector);
  const amplitudeTransform = () => query<SVGGElement>('.amplitude')!.style.transform;

  describe('accessibility', () => {
    it('exposes the progress as a 0-100 progressbar', async () => {
      await render({ value: 42 });

      expect(host.getAttribute('role')).toBe('progressbar');
      expect(host.getAttribute('aria-valuemin')).toBe('0');
      expect(host.getAttribute('aria-valuemax')).toBe('100');
      expect(host.getAttribute('aria-valuenow')).toBe('42');
    });

    it.each([
      [-20, '0'],
      [150, '100'],
    ])('clamps a value of %i to %s', async (value, expected) => {
      await render({ value });
      expect(host.getAttribute('aria-valuenow')).toBe(expected);
    });

    it('drops the value attributes while indeterminate', async () => {
      await render({ value: 42, indeterminate: true });

      expect(host.hasAttribute('aria-valuemin')).toBe(false);
      expect(host.hasAttribute('aria-valuemax')).toBe(false);
      expect(host.hasAttribute('aria-valuenow')).toBe(false);
    });

    it('sets aria-label only when a label is given', async () => {
      await render();
      expect(host.hasAttribute('aria-label')).toBe(false);

      await render({ label: 'Download progress' });
      expect(host.getAttribute('aria-label')).toBe('Download progress');
    });

    it('hides the decorative svg', async () => {
      await render();
      expect(query('svg')!.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('determinate', () => {
    it('renders the track, stop indicator and one active wave', async () => {
      await render({ value: 50 });

      expect(query('.inactive')).not.toBeNull();
      expect(query('.stop')).not.toBeNull();
      expect(queryAll('.layer.active')).toHaveLength(1);
      expect(query('[class*="indeterminate"]')).toBeNull();
    });

    it('clips the wave to the progress', async () => {
      await render({ value: 30 });
      expect(query('.active')!.style.clipPath).toBe('inset(0 70% 0 0)');

      await render({ value: 150 });
      expect(query('.active')!.style.clipPath).toBe('inset(0 0% 0 0)');
    });

    it('starts the inactive track after the gap', async () => {
      await render({ value: 30 });
      expect(query('.inactive')!.style.left).toBe('calc(30% + var(--rt-progress-gap))');
    });

    it.each([
      [0, 'scaleY(0.001)'],
      [10, 'scaleY(0.001)'],
      [11, 'scaleY(1)'],
      [94, 'scaleY(1)'],
      [95, 'scaleY(0.001)'],
      [100, 'scaleY(0.001)'],
    ])('scales the wave at %i%% to %s', async (value, transform) => {
      await render({ value });
      expect(amplitudeTransform()).toBe(transform);
    });
  });

  describe('play head', () => {
    it('is hidden by default', async () => {
      await render({ value: 50 });
      expect(query('.play-head')).toBeNull();
    });

    it('sits in the gap, clamped to the end of the track', async () => {
      await render({ value: 50, showPlayHead: true });

      expect(query('.play-head')!.style.left).toBe(
        'min(calc(50% + var(--rt-progress-gap) / 2), calc(100% - var(--rt-progress-play-head-width) / 2))',
      );
    });

    it('is not drawn while indeterminate', async () => {
      await render({ value: 50, showPlayHead: true, indeterminate: true });
      expect(query('.play-head')).toBeNull();
    });
  });

  describe('indeterminate', () => {
    it('renders two looping waves instead of the track', async () => {
      await render({ indeterminate: true });

      expect(query('.indeterminate-a svg')).not.toBeNull();
      expect(query('.indeterminate-b svg')).not.toBeNull();
      expect(query('.active')).toBeNull();
      expect(query('.inactive')).toBeNull();
      expect(query('.stop')).toBeNull();
    });

    it('keeps the full amplitude regardless of the value', async () => {
      await render({ indeterminate: true, value: 0 });

      queryAll('.amplitude').forEach((el) => expect((el as SVGGElement).style.transform).toBe('scaleY(1)'));
    });
  });

  describe('sizing', () => {
    it('exposes the default dimensions as css variables', async () => {
      await render();

      expect(host.style.getPropertyValue('--rt-thickness')).toBe('3px');
      expect(host.style.getPropertyValue('--rt-wave-length')).toBe('30px');
      expect(host.style.getPropertyValue('--rt-wave-duration')).toBe('0.667s');
      expect(host.style.getPropertyValue('--rt-track-height')).toBe('9px');
      expect(query('svg')!.getAttribute('height')).toBe('9');
    });

    it('derives the track height from thickness and amplitude', async () => {
      await render({ thickness: 4, amplitude: 5 });

      expect(host.style.getPropertyValue('--rt-track-height')).toBe('14px');
      expect(query('svg')!.getAttribute('height')).toBe('14');
    });

    it('converts speed to an animation duration', async () => {
      await render({ speed: 2 });
      expect(host.style.getPropertyValue('--rt-wave-duration')).toBe('0.5s');
    });

    it('guards against a zero speed', async () => {
      await render({ speed: 0 });
      expect(host.style.getPropertyValue('--rt-wave-duration')).toBe('1000s');
    });
  });

  describe('wave path', () => {
    const path = () => query('path')!.getAttribute('d')!;

    it('starts one wavelength before the track on the centre line', async () => {
      await render();
      expect(path().startsWith('M-30 4.5')).toBe(true);
    });

    it('alternates crests and troughs, one curve per half wavelength', async () => {
      await render();

      const curves = path().match(/c[^c]+/g)!;
      expect(curves[0]).toBe('c5 -4 10 -4 15 0');
      expect(curves[1]).toBe('c5 4 10 4 15 0');
      // (4096 span + 30 lead-in) / 15 per half wave, rounded up
      expect(curves).toHaveLength(276);
    });

    it('follows the amplitude and wavelength inputs', async () => {
      await render({ amplitude: 6, waveLength: 60, thickness: 2 });

      expect(path().startsWith('M-60 7c10 -8 20 -8 30 0c10 8 20 8 30 0')).toBe(true);
    });
  });
});
