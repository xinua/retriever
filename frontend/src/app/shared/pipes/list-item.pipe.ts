import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'listItem',
})
export class ListItemPipe implements PipeTransform {
  transform(value: string, returnBoolean: boolean = false): string | boolean {
    const isSubItem = value.startsWith('- ');
    if (returnBoolean) return isSubItem;

    return isSubItem ? value.slice(2) : value;
  }
}
