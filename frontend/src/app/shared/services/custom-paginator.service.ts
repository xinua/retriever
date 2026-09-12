import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

@Injectable()
export class CustomPaginatorIntl extends MatPaginatorIntl {
  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) {
      return `Page 1 of 1`;
    }
    const totalPages = Math.ceil(length / pageSize);
    return `Page ${page + 1} of ${totalPages}`;
  };
}
