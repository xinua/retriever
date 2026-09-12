import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { APP_VERSION } from '@shared/constants';

import { AppVersion } from './app-version';
import { provideNotifier, useIconFactory } from '../../providers';
import { inject, provideAppInitializer } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';

describe('AppVersion', () => {
  let component: AppVersion;
  let fixture: ComponentFixture<AppVersion>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppVersion],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNotifier(),
        provideAppInitializer(() => {
          const initializerFn = useIconFactory(inject(DomSanitizer), inject(MatIconRegistry));
          return initializerFn();
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppVersion);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the version generated from package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fixture.nativeElement.textContent).toContain(APP_VERSION);
  });
});
