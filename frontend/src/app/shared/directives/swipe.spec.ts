import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SwipeDirective, SwipeEvent } from './swipe';

@Component({
  imports: [SwipeDirective],
  template: `
    <div rtSwipe [swipeThreshold]="80" [swipeDisabled]="disabled()" (rtSwipe)="swipes.push($event)">
      <button (click)="clicks = clicks + 1">Action</button>
    </div>
  `,
})
class HostComponent {
  disabled = signal(false);
  swipes: SwipeEvent[] = [];
  clicks = 0;
}

describe('SwipeDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();

    el = fixture.nativeElement.querySelector('[rtSwipe]');
    // jsdom has no pointer capture.
    el.setPointerCapture = vi.fn();
    el.releasePointerCapture = vi.fn();
    el.hasPointerCapture = vi.fn(() => false);
  });

  /** jsdom has no PointerEvent, so the fields the directive reads are set on a plain event. */
  function pointer(type: string, clientX: number, clientY = 0, pointerType = 'touch') {
    el.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, pointerType, clientX, clientY }));
  }

  function swipe(dx: number, dy = 0, pointerType = 'touch') {
    pointer('pointerdown', 100, 100, pointerType);
    pointer('pointermove', 100 + dx, 100 + dy, pointerType);
    pointer('pointerup', 100 + dx, 100 + dy, pointerType);
  }

  it('emits the direction of a horizontal swipe past the threshold', () => {
    swipe(-120);
    swipe(120);

    expect(host.swipes).toEqual([{ direction: 'left' }, { direction: 'right' }]);
  });

  it('does not emit for a swipe shorter than the threshold', () => {
    swipe(-50);
    expect(host.swipes).toEqual([]);
  });

  it('ignores mostly vertical gestures', () => {
    swipe(-90, 200);
    expect(host.swipes).toEqual([]);
  });

  it('ignores mouse pointers', () => {
    swipe(-120, 0, 'mouse');
    expect(host.swipes).toEqual([]);
  });

  it('does nothing while disabled', async () => {
    host.disabled.set(true);
    await fixture.whenStable();

    swipe(-120);
    expect(host.swipes).toEqual([]);
  });

  it('moves the element with the finger and resets it on release', () => {
    pointer('pointerdown', 100);
    pointer('pointermove', 20);

    expect(el.style.transform).toContain('translateX(-52px)');
    expect(el.setPointerCapture).toHaveBeenCalledWith(1);

    pointer('pointerup', 20);
    expect(el.style.transform).toBe('');
    expect(el.style.opacity).toBe('');
  });

  it('swallows the click that ends a swipe, but not later clicks', () => {
    const button: HTMLButtonElement = el.querySelector('button');

    swipe(-120);
    button.click();
    expect(host.clicks).toBe(0);

    button.click();
    expect(host.clicks).toBe(1);
  });
});
