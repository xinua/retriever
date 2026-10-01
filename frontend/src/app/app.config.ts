import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { routes } from './app.routes';
import { errorInterceptor } from './shared/interceptors/error.interceptor';
import { provideNotifier } from './shared/providers/notifier.provider';
import { UiConfigService } from './shared/services';
import { useIconFactory } from './shared/providers/icons.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideNotifier(),
    provideHttpClient(withInterceptors([errorInterceptor])),
    provideNativeDateAdapter(),
    provideAppInitializer(() => {
      const initializerFn = useIconFactory(inject(DomSanitizer), inject(MatIconRegistry));
      return initializerFn();
    }),
    provideAppInitializer(() => {
      inject(UiConfigService);
    }),
  ],
};
