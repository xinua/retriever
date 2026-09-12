import { Pipe, PipeTransform } from '@angular/core';
import { IntervalRangeModel } from '@shared/models';

@Pipe({
  name: 'pollCounter',
})
export class PollCounterPipe implements PipeTransform {
  transform(value: Partial<IntervalRangeModel>, pollInterval: number): number {
    const hours = value.end - value.start;
    const count = (hours * 60) / pollInterval;
    return Number.isFinite(count) ? Math.max(2, Math.ceil(count)) : 0;
  }
}
