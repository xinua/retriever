import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { APP_VERSION } from '@shared/constants';
import { VersionModel } from '@shared/models';

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

  describe('cacheExpired', () => {
    const info = (current: string | null) => ({ current }) as VersionModel;

    it('is false before the version is known', () => {
      expect(component.cacheExpired()).toBe(false);
    });

    it('is true when the server runs a newer version than this bundle', () => {
      component.versionInfo.set(info('999.0.0'));
      expect(component.cacheExpired()).toBe(true);
    });

    it('is false when the server runs this version or an older one', () => {
      component.versionInfo.set(info(APP_VERSION));
      expect(component.cacheExpired()).toBe(false);

      component.versionInfo.set(info('0.0.1'));
      expect(component.cacheExpired()).toBe(false);
    });
  });

  describe('onClick', () => {
    // jsdom's location cannot be replaced, so the reload itself is stubbed.
    beforeEach(() => {
      vi.spyOn(component, 'reloadPage').mockImplementation(() => undefined);
      vi.spyOn(component, 'showReleaseNotes').mockImplementation(() => undefined);
    });

    it('reloads the page when the cache is outdated', () => {
      component.versionInfo.set({ current: '999.0.0' } as VersionModel);
      component.onClick();
      expect(component.reloadPage).toHaveBeenCalledOnce();
      expect(component.showReleaseNotes).not.toHaveBeenCalled();
    });

    it('opens the release notes otherwise', () => {
      component.versionInfo.set({ current: APP_VERSION } as VersionModel);
      component.onClick();
      expect(component.reloadPage).not.toHaveBeenCalled();
      expect(component.showReleaseNotes).toHaveBeenCalledOnce();
    });
  });
});
