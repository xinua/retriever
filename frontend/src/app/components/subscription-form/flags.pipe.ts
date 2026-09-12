import { Pipe, PipeTransform } from '@angular/core';
import { SubscriptionFlag } from './subscription-form.model';
import { SUBSCRIPTION_FLAG_OPTIONS } from './subscription-form.const';

@Pipe({
  name: 'flags',
  standalone: true,
})
export class FlagsPipe implements PipeTransform {
  readonly flags = SUBSCRIPTION_FLAG_OPTIONS;

  transform(value: string): SubscriptionFlag {
    return this.flags?.find((flag) => flag.value === value);
  }
}
