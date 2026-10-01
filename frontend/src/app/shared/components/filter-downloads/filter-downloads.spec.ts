import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FilterDownloads } from './filter-downloads';
import { DefaultFilters } from '@shared/constants';
import { DownloadStatus, FilterModel, Types } from '@shared/models';
import { StorageService } from '@shared/services';

describe('FilterDownloads', () => {
  let component: FilterDownloads;
  let fixture: ComponentFixture<FilterDownloads>;
  let storage: StorageService;
  let emitted: FilterModel[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilterDownloads],
    }).compileComponents();

    storage = TestBed.inject(StorageService);
    storage.filters.set(DefaultFilters);

    fixture = TestBed.createComponent(FilterDownloads);
    component = fixture.componentInstance;
    emitted = [];
    component.startFiltering.subscribe((filters) => emitted.push(filters));
    await fixture.whenStable();
  });

  afterEach(() => vi.useRealTimers());

  const icon = (): string => fixture.nativeElement.querySelector('mat-icon').getAttribute('fontIcon');

  it('toggles a filter on and off in its group', () => {
    component.filterDownloads({ group: 'types', filter: Types.VIDEO });
    expect(storage.filters()).toEqual({ types: [Types.VIDEO], statuses: [] });

    component.filterDownloads({ group: 'statuses', filter: DownloadStatus.DONE });
    expect(storage.filters()).toEqual({ types: [Types.VIDEO], statuses: [DownloadStatus.DONE] });

    component.filterDownloads({ group: 'types', filter: Types.VIDEO });
    expect(storage.filters()).toEqual({ types: [], statuses: [DownloadStatus.DONE] });
  });

  it('shows whether any filter is active', async () => {
    expect(component.hasActiveFilters()).toBe(false);
    expect(icon()).toBe('filter_alt_off');

    component.filterDownloads({ group: 'statuses', filter: DownloadStatus.FAILED });
    await fixture.whenStable();

    expect(component.hasActiveFilters()).toBe(true);
    expect(icon()).toBe('filter_alt');
  });

  it('emits once after a burst of changes settles', () => {
    vi.useFakeTimers();

    component.filterDownloads({ group: 'types', filter: Types.VIDEO });
    component.filterDownloads({ group: 'types', filter: Types.AUDIO });
    vi.advanceTimersByTime(199);
    expect(emitted).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([{ types: [Types.VIDEO, Types.AUDIO], statuses: [] }]);
  });

  it('does not emit again when the filters end up unchanged', () => {
    vi.useFakeTimers();

    component.filterDownloads({ group: 'types', filter: Types.VIDEO });
    vi.advanceTimersByTime(200);

    // Off and back on within the debounce window lands on the same filters.
    component.filterDownloads({ group: 'types', filter: Types.VIDEO });
    component.filterDownloads({ group: 'types', filter: Types.VIDEO });
    vi.advanceTimersByTime(200);

    expect(emitted).toHaveLength(1);
  });
});
