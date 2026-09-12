import { Pipe, PipeTransform } from '@angular/core';
import { FilterModel } from '@shared/models';

@Pipe({
  name: 'isActiveFilter',
  standalone: true,
})
export class IsActiveFilterPipe implements PipeTransform {
  transform(filter: string, filters: FilterModel): boolean {
    if (!filters || !filter) return false;
    return Object.values(filters)?.some((group) => group?.includes(filter));
  }
}
