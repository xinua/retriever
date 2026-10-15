import { Pipe, PipeTransform } from '@angular/core';
import { folderOf } from '../helpers/common.helpers';

@Pipe({
  name: 'folderOf',
})
export class FolderOfPipe implements PipeTransform {
  transform(value: string): string {
    return folderOf(value);
  }
}
