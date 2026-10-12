import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LongPress } from './long-press';

@Component({
  imports: [LongPress],
  template: `<a href="#" rtLongPress rtThreshold="300" (rtLongPress)="presses = presses + 1">Link</a>`,
})
class HostComponent {
  presses = 0;
}

describe('LongPress', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
    el = fixture.nativeElement.querySelector('[rtLongPress]');
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  /** jsdom has no PointerEvent, so the fields the directive reads are set on a plain event. */
  function pointer(type: string, button = 0) {
    el.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { button }));
  }

  function click(): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event;
  }

  it('emits after holding past the threshold', () => {
    pointer('pointerdown');
    vi.advanceTimersByTime(299);
    expect(host.presses).toBe(0);

    vi.advanceTimersByTime(1);
    expect(host.presses).toBe(1);
  });

  it.each(['pointerup', 'pointerleave', 'pointercancel', 'dragstart'])('cancels on %s', (type) => {
    pointer('pointerdown');
    pointer(type);
    vi.advanceTimersByTime(1000);

    expect(host.presses).toBe(0);
  });

  it('ignores non-primary buttons', () => {
    pointer('pointerdown', 2);
    vi.advanceTimersByTime(1000);

    expect(host.presses).toBe(0);
  });

  it('swallows only the click that follows a long press', () => {
    pointer('pointerdown');
    vi.advanceTimersByTime(300);
    pointer('pointerup');

    expect(click().defaultPrevented).toBe(true);
    expect(click().defaultPrevented).toBe(false);
  });

  it('lets a short tap click through', () => {
    pointer('pointerdown');
    pointer('pointerup');

    expect(click().defaultPrevented).toBe(false);
  });

  it('suppresses the context menu only while pressing', () => {
    const menu = () => {
      const event = new Event('contextmenu', { cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(menu()).toBe(false);

    pointer('pointerdown');
    expect(menu()).toBe(true);
  });

  it('clears a pending press on destroy', () => {
    pointer('pointerdown');
    fixture.destroy();
    vi.advanceTimersByTime(1000);

    expect(host.presses).toBe(0);
  });
});
