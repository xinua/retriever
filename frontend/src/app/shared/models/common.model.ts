import { DownloadStatus } from './download.model';
import { Types } from './subscription.model';

export type Nullable<T> = T | null;

export interface PaginatorModel {
  total: number;
  page: number;
  limit: number;
}

export interface FilterModel {
  types: Types[];
  statuses: DownloadStatus[];
}

export interface FilterGroupModel {
  name: keyof FilterModel;
  filters: FilterModel[keyof FilterModel];
}
