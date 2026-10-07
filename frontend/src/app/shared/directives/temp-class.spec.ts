import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TempClass } from './temp-class';

@Component({
  imports: [TempClass],
  template: `
    <div class="base" [rtTempClass]="cls()" [rtTempClassDuration]="seconds()" [rtTempClassEvent]="event()"></div>
  `,
})
class HostComponent {
  cls = signal('flash');
  seconds = signal(2);
  event = signal('click');
}

describe('TempClass', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    el = fixture.nativeElement.querySelector('div');
  });

  afterEach(() => vi.useRealTimers());

  it('should add the class on click for the given number of seconds', () => {
    expect(el.classList).not.toContain('flash');

    el.click();
    expect(el.classList).toContain('flash');

    vi.advanceTimersByTime(1999);
    expect(el.classList).toContain('flash');

    vi.advanceTimersByTime(1);
    expect(el.className).toBe('base');
  });

  it('should restart the timer on repeated events', () => {
    el.click();
    vi.advanceTimersByTime(1500);
    el.click();

    vi.advanceTimersByTime(1999);
    expect(el.classList).toContain('flash');
    vi.advanceTimersByTime(1);
    expect(el.classList).not.toContain('flash');
  });

  it('should support multiple classes', () => {
    fixture.componentInstance.cls.set('shake wobble');
    fixture.detectChanges();

    el.click();
    expect(el.classList).toContain('shake');
    expect(el.classList).toContain('wobble');
  });

  it('should listen to the configured event', () => {
    fixture.componentInstance.event.set('mouseenter');
    fixture.detectChanges();

    el.click();
    expect(el.classList).not.toContain('flash');

    el.dispatchEvent(new Event('mouseenter'));
    expect(el.classList).toContain('flash');
  });
});
