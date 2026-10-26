import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AutoHide } from './auto-hide';

@Component({
  imports: [AutoHide],
  template: `
    <div rtAutoHide #autoHide="rtAutoHide" [rtAutoHideDelay]="delay()">
      <div class="controls" [class]="autoHide.hidden() ? 'opacity-0 pointer-events-none' : ''"></div>
    </div>
  `,
})
class HostComponent {
  delay = signal(1000);
}

describe('AutoHide', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  /** Whether the browser has a hovering pointer at all; the test environment answers nothing on its own. */
  function canHover(matches: boolean) {
    vi.stubGlobal('matchMedia', () => ({ matches }) as MediaQueryList);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();

    canHover(true);
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    host = fixture.nativeElement.querySelector('div');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const controls = (): HTMLElement => fixture.nativeElement.querySelector('.controls');
  const hidden = (): boolean => controls().classList.contains('opacity-0');

  async function pointer(...events: string[]) {
    vi.useFakeTimers();
    try {
      for (const event of events) {
        if (event.startsWith('wait:')) vi.advanceTimersByTime(+event.slice(5));
        else host.dispatchEvent(new MouseEvent(event));
      }
    } finally {
      vi.useRealTimers();
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('shows the controls until the pointer has been away for the delay', async () => {
    expect(hidden()).toBe(false);

    // One fake-timer run: switching back to real timers would drop the pending timeout.
    vi.useFakeTimers();
    host.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(999);
    fixture.detectChanges();
    expect(hidden()).toBe(false);

    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(hidden()).toBe(true);
    // Invisible controls would still swallow what is aimed at whatever sits behind them.
    expect(controls().classList).toContain('pointer-events-none');
  });

  it('keeps the controls when the pointer comes back within the delay', async () => {
    await pointer('mouseleave', 'wait:999', 'mouseenter', 'wait:1000');

    expect(hidden()).toBe(false);
  });

  it('brings the controls back when the pointer returns', async () => {
    await pointer('mouseleave', 'wait:1000');
    expect(hidden()).toBe(true);

    await pointer('mouseenter');
    expect(hidden()).toBe(false);
  });

  it('never hides them where there is no hovering pointer', async () => {
    canHover(false);

    await pointer('mouseleave', 'wait:5000');

    expect(hidden()).toBe(false);
  });

  it('takes the delay from the host', async () => {
    fixture.componentInstance.delay.set(300);
    await fixture.whenStable();

    await pointer('mouseleave', 'wait:300');

    expect(hidden()).toBe(true);
  });
});
