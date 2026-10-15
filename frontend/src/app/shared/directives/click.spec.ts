import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClickAction, ClickEvent, DoubleClick } from './click';

@Component({
  imports: [DoubleClick],
  template: `<button rtClick [rtClickDelay]="200" (rtClick)="events.push($event)">Action</button>`,
})
class HostComponent {
  events: ClickEvent[] = [];
}

describe('DoubleClick', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  const actions = (): ClickAction[] => host.events.map((e) => e.action);

  beforeEach(async () => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
    el = fixture.nativeElement.querySelector('[rtClick]');
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('emits single after the delay', () => {
    el.click();
    vi.advanceTimersByTime(199);
    expect(actions()).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(actions()).toEqual([ClickAction.SINGLE]);
    expect(host.events[0].event).toBeInstanceOf(MouseEvent);
  });

  it('emits only double for two clicks within the delay', () => {
    el.click();
    vi.advanceTimersByTime(100);
    el.click();
    vi.advanceTimersByTime(500);

    expect(actions()).toEqual([ClickAction.DOUBLE]);
  });

  it('emits two singles for clicks further apart than the delay', () => {
    el.click();
    vi.advanceTimersByTime(250);
    el.click();
    vi.advanceTimersByTime(250);

    expect(actions()).toEqual([ClickAction.SINGLE, ClickAction.SINGLE]);
  });

  it('does not emit after destroy', () => {
    el.click();
    fixture.destroy();
    vi.advanceTimersByTime(500);

    expect(actions()).toEqual([]);
  });
});
