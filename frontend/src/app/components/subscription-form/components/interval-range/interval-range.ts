import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  ControlValueAccessor,
  FormControl,
  FormGroup,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { MatError, MatHint } from '@angular/material/form-field';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IntervalRangeModel, Nullable } from '@shared/models';

/** Hours the slider spans. Covering all of it means the subscription is polled around the clock. */
const DAY_START = 0;
const DAY_END = 24;

/** Whole hours only, the way the slider offers them. */
const formatHour = (hour: number): string => `${hour.toString().padStart(2, '0')}:00`;

@Component({
  selector: 'rt-interval-range',
  templateUrl: './interval-range.html',
  styleUrl: './interval-range.css',
  imports: [ReactiveFormsModule, MatSliderModule, MatHint, MatError, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => IntervalRange),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => IntervalRange),
      multi: true,
    },
  ],
})
export class IntervalRange implements ControlValueAccessor, Validator {
  private readonly _destroyRef = inject(DestroyRef);
  interval = input<number>(0);

  /** Inner form. Bound with `formControlName`, so it must never see the parent's form group. */
  protected readonly range = new FormGroup({
    start: new FormControl(DAY_START, { nonNullable: true }),
    end: new FormControl(DAY_END, { nonNullable: true }),
  });

  /** Mirrors `range`'s value as a signal, to keep the template reactive under `OnPush`. */
  private readonly _value = signal<IntervalRangeModel>({ start: DAY_START, end: DAY_END });

  /** The thumbs can be dragged onto each other, which would leave no hours to poll in. */
  protected readonly isSameHour = computed(() => {
    const { start, end } = this._value();
    return start === end;
  });

  /** The slider only labels the hours while a thumb is being dragged, so spell the range out below it. */
  protected readonly hint = computed(() => {
    const { start, end } = this._value();

    return this._isAllDay({ start, end })
      ? 'The full range places no limit: the subscription is polled all day.'
      : `Polled only between ${formatHour(start)} and ${formatHour(end)}.`;
  });

  count = computed<number>(() => {
    const { start, end } = this._value();
    const hours = end - start;
    const intervalsFit = (hours * 60) / this.interval();

    return Number.isFinite(intervalsFit) ? Math.max(2, Math.ceil(intervalsFit) + 1) : 0;
  });

  protected readonly formatLabel = formatHour;

  private _onTouched: () => void = () => {};
  private _onChange: (value: Nullable<IntervalRangeModel>) => void = () => {};

  constructor() {
    this.range.valueChanges.pipe(takeUntilDestroyed(this._destroyRef)).subscribe((value) => {
      const range = { start: value.start ?? DAY_START, end: value.end ?? DAY_END };

      this._value.set(range);
      this._onChange(this._isAllDay(range) ? null : range);
    });
  }

  writeValue(value: Nullable<IntervalRangeModel>): void {
    const range = { start: value?.start ?? DAY_START, end: value?.end ?? DAY_END };

    this.range.setValue(range, { emitEvent: false });
    this._value.set(range);
  }

  registerOnChange(fn: (value: Nullable<IntervalRangeModel>) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    if (isDisabled) {
      this.range.disable({ emitEvent: false });
    } else {
      this.range.enable({ emitEvent: false });
    }
  }

  /** Start and end on the same hour describe an empty window, not a period. */
  validate(control: AbstractControl<Nullable<IntervalRangeModel>>): Nullable<ValidationErrors> {
    const value = control.value;
    return value && value.start === value.end ? { intervalRangeSameHour: true } : null;
  }

  protected markTouched(): void {
    this._onTouched();
  }

  /** An unrestricted range is the same thing as no range at all, and is stored as `null`. */
  private _isAllDay({ start, end }: IntervalRangeModel): boolean {
    return start === DAY_START && end === DAY_END;
  }
}
