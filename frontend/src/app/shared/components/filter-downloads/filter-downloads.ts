import { TitleCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { DefaultFilterGroups, DefaultFilters } from '../../constants/defaults.const';
import { FilterModel } from '../../models/common.model';
import { StorageService } from '../../services/storage.service';
import { debounceTime, distinctUntilChanged, Subject, tap } from 'rxjs';
import { IsActiveFilterPipe } from './is-active-filter.pipe';
import { LongPress } from '../../directives/long-press';
import { MatTooltip } from '@angular/material/tooltip';

@Component({
  selector: 'rt-filter-downloads',
  imports: [MatIcon, MatMenuModule, MatButtonModule, TitleCasePipe, IsActiveFilterPipe, LongPress, MatTooltip],
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
  animateShake = signal(false);

  ngOnInit(): void {
    this._trigger$
      .pipe(
        debounceTime(200),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        tap(() => this.startFiltering.emit(this.filters())),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe();
  }

  filterDownloads({ group, filter }: { group: string; filter: string }) {
    this._toggleFilter(group, filter);
    this._trigger$.next(this.filters());
  }

  resetFilters() {
    if (!this.hasActiveFilters()) return;
    this.animateShake.set(true);
    this.filters.set(DefaultFilters);
    this.startFiltering.emit(this.filters());
    setTimeout(() => this.animateShake.set(false), 300);
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
