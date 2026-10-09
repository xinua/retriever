import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'size',
  standalone: true,
})
export class SizePipe implements PipeTransform {
  transform(bytes: number | null, decimalPlaces = 1): string {
    if (!bytes) return '';

    const units = ['B', 'KB', 'MB', 'GB'];

    let value = bytes;
    let unit = 0;

    while (value >= 1000 && unit < units.length - 1) {
      value /= 1000;
      unit += 1;
    }

    return `${value.toFixed(decimalPlaces)} ${units[unit]}`;
  }
}
