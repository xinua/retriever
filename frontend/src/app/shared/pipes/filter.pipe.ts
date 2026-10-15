import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'filter',
})
export class FilterPipe implements PipeTransform {
  transform(source: string[], filter: string): string[] {
    if (!filter) return source;
    return source.filter((item) => item.toLowerCase().includes(filter.toLowerCase()));
  }
}
