import { Pipe, PipeTransform } from '@angular/core';

type SortType = 'contains';
type Direction = 'asc' | 'desc';

@Pipe({
  name: 'sort',
})
export class SortPipe implements PipeTransform {
  transform(collection: string[], sortBy: string, direction: Direction = 'asc', sortType: SortType): string[] {
    const sign = direction === 'asc' ? 1 : -1;
    const rank = (el: string) => (sortType === 'contains' ? el.split(sortBy).length - 1 : Number(el === sortBy));

    return [...collection].sort((a, b) => sign * (rank(a) - rank(b) || a.localeCompare(b)));
  }
}
