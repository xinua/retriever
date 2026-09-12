import { ComponentFixture, TestBed } from '@angular/core/testing';

import { inject, provideAppInitializer } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { VersionModel } from '@shared/models';
import { useIconFactory } from '../../providers';
import { ReleaseNotesDialog } from './release-notes-dialog';

const mockData: VersionModel = {
  version: '1.0.0',
  releaseDate: '2026-01-01',
  changelog: [
    {
      version: '1.0.1',
      releaseDate: '2026-09-17',
      changelog: {
        bugfixes: ['Bugfix 1'],
        features: ['Feature 1'],
        improvements: ['Improvement 1'],
        other: ['Other 1'],
      },
    },
    {
      version: '1.0.0',
      releaseDate: '2026-01-01',
      changelog: {
        bugfixes: [],
        features: [],
        improvements: [],
        other: [],
      },
    },
  ],
  current: '1.0.0',
  latest: '1.0.1',
  updateAvailable: false,
  checkedAt: '2026-01-01',
  nextCheckAt: '2026-01-01',
  error: null,
};

describe('ReleaseNotesDialog', () => {
  let component: ReleaseNotesDialog;
  let fixture: ComponentFixture<ReleaseNotesDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReleaseNotesDialog],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: mockData,
        },
        {
          provide: MatDialogRef<ReleaseNotesDialog>,
          useValue: {},
        },
        provideAppInitializer(() => {
          const initializerFn = useIconFactory(inject(DomSanitizer), inject(MatIconRegistry));
          return initializerFn();
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReleaseNotesDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the latest version', () => {
    const latestChangelog = mockData.changelog[0].changelog;
    expect(JSON.stringify(component.latestChangelog())).toBe(JSON.stringify(latestChangelog));
  });

  it('should render the current version', () => {
    expect(component.currentVersionInfo()?.version).toBe(mockData.current);
  });

  it('should render the release date', () => {
    expect(component.currentVersionInfo().releaseDate).toBe(mockData.releaseDate);
  });
});
