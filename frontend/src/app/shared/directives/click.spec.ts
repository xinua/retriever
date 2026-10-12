import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Click, ClickAction } from './click';

@Component({
  imports: [Click],
  template: `<button rtClick [rtClickDelay]="200" (rtClick)="actions.push($event)">Action</button>`,
})
class HostComponent {
  actions: ClickAction[] = [];
}

describe('Click', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

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
    expect(host.actions).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(host.actions).toEqual(['single']);
  });

  it('emits only double for two clicks within the delay', () => {
    el.click();
    vi.advanceTimersByTime(100);
    el.click();
    vi.advanceTimersByTime(500);

    expect(host.actions).toEqual(['double']);
  });

  it('emits two singles for clicks further apart than the delay', () => {
    el.click();
    vi.advanceTimersByTime(250);
    el.click();
    vi.advanceTimersByTime(250);

    expect(host.actions).toEqual(['single', 'single']);
  });

  it('does not emit after destroy', () => {
    el.click();
    fixture.destroy();
    vi.advanceTimersByTime(500);

    expect(host.actions).toEqual([]);
  });
});
