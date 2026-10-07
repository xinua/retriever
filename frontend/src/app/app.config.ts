import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { routes } from './app.routes';
import { errorInterceptor } from './shared/interceptors/error.interceptor';
import { provideNotifier } from './shared/providers/notifier.provider';
import { UiConfigService } from './shared/services';
import { useIconFactory } from './shared/providers/icons.provider';
import { provideCodeHighlight } from './shared/providers/highlight.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideNotifier(),
    // CDK 21 renders overlays as popovers in the browser top layer, above any z-index.
    // Opt out so the notifier (z-index 10000) can sit above the overlay container (1000).
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    provideHttpClient(withInterceptors([errorInterceptor])),
    provideNativeDateAdapter(),
    provideAppInitializer(() => {
      const initializerFn = useIconFactory(inject(DomSanitizer), inject(MatIconRegistry));
      return initializerFn();
    }),
    provideAppInitializer(() => {
      inject(UiConfigService);
    }),
    provideCodeHighlight(),
  ],
};
