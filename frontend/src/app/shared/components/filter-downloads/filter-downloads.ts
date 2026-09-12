import { TitleCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { DefaultFilterGroups } from '@shared/constants';
import { FilterModel } from '@shared/models';
import { StorageService } from '@shared/services';
import { debounceTime, distinctUntilChanged, Subject, tap } from 'rxjs';
import { IsActiveFilterPipe } from './is-active-filter.pipe';

@Component({
  selector: 'rt-filter-downloads',
  imports: [MatIcon, MatMenuModule, MatButtonModule, TitleCasePipe, IsActiveFilterPipe],
  templateUrl: './filter-downloads.html',
})
export class FilterDownloads implements OnInit {
  private readonly _storage = inject(StorageService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _trigger$ = new Subject<FilterModel>();

  startFiltering = output<FilterModel>();

  filters = this._storage.filters;
  filterGroups = signal(DefaultFilterGroups);
  hasActiveFilters = computed(() => !!this.filters().statuses.length || !!this.filters().types.length);

  ngOnInit(): void {
    this._trigger$
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        debounceTime(200),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        tap(() => this.startFiltering.emit(this.filters())),
      )
      .subscribe();
  }

  filterDownloads({ group, filter }: { group: string; filter: string }) {
    this._toggleFilter(group, filter);
    this._trigger$.next(this.filters());
  }

  private _toggleFilter(group: string, filter: string) {
    this.filters.update((currentFilters) => ({
      ...currentFilters,
      [group]: currentFilters[group]?.includes(filter)
        ? currentFilters[group]?.filter((f) => f !== filter)
        : [...currentFilters[group], filter],
    }));
  }
}
