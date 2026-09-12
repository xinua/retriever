import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { IntervalRangeModel, Nullable } from '@shared/models';

import { IntervalRange } from './interval-range';

@Component({
  imports: [ReactiveFormsModule, IntervalRange],
  template: `<rt-interval-range [formControl]="range" />`,
})
class Host {
  readonly range = new FormControl<Nullable<IntervalRangeModel>>(null);
}

describe('IntervalRange', () => {
  let fixture: ComponentFixture<Host>;
  let range: FormControl<Nullable<IntervalRangeModel>>;

  const thumbs = () => Array.from(document.querySelectorAll<HTMLInputElement>('mat-slider input'));

  const drag = async (thumb: HTMLInputElement, hour: number) => {
    thumb.value = `${hour}`;
    thumb.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();

    fixture = TestBed.createComponent(Host);
    range = fixture.componentInstance.range;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('spans the whole day for an empty value', () => {
    const [start, end] = thumbs();

    expect(start.value).toBe('0');
    expect(end.value).toBe('24');
  });

  it('writes a narrowed range back to the form control', async () => {
    const [start, end] = thumbs();

    await drag(start, 8);
    await drag(end, 20);

    expect(range.value).toEqual({ start: 8, end: 20 });
    expect(range.valid).toBe(true);
  });

  it('stores the full range as null, since it places no limit', async () => {
    const [start] = thumbs();

    await drag(start, 8);
    expect(range.value).toEqual({ start: 8, end: 24 });

    await drag(start, 0);
    expect(range.value).toBeNull();
  });

  it('shows an incoming range on the slider', async () => {
    range.setValue({ start: 6, end: 18 });
    await fixture.whenStable();

    const [start, end] = thumbs();
    expect(start.value).toBe('6');
    expect(end.value).toBe('18');
  });

  it('is invalid when both ends sit on the same hour', async () => {
    range.setValue({ start: 10, end: 10 });
    expect(range.errors).toEqual({ intervalRangeSameHour: true });
  });
});
