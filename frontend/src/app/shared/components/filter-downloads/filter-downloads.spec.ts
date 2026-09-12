import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FilterDownloads } from './filter-downloads';

describe('FilterDownloads', () => {
  let component: FilterDownloads;
  let fixture: ComponentFixture<FilterDownloads>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilterDownloads],
    }).compileComponents();

    fixture = TestBed.createComponent(FilterDownloads);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
