import { HttpContext, HttpContextToken } from '@angular/common/http';
import type { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { NotifierService } from 'angular-notifier';
import { catchError, throwError } from 'rxjs';

/**
 * Marks a request whose failure is an answer rather than a fault, so the
 * interceptor below leaves it alone.
 *
 * The existence probes are the reason it exists: a HEAD that comes back 404
 * means "no file", which the caller turns into a `false` and renders — popping
 * a red toast for it would report a working feature as a broken one.
 */
export const SKIP_ERROR_NOTIFIER = new HttpContextToken<boolean>(() => false);

/** Convenience for the call sites: `{ context: silent() }`. */
export function silent(): HttpContext {
  return new HttpContext().set(SKIP_ERROR_NOTIFIER, true);
}

/**
 * Functional interceptors run inside the injection context of the injector that
 * created HttpClient — the root environment injector. NotifierService therefore
 * has to be provided there, which provideNotifier() in appConfig does, and only
 * there, so this is the same instance components inject and the same queue the
 * notifier container renders from.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifier = inject(NotifierService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (req.context.get(SKIP_ERROR_NOTIFIER)) return throwError(() => error);

      const status = error.status || 'unknown';
      // const message = error.error?.message || error.statusText || 'Request failed';
      const message = error.error?.error || error.error?.message || error.statusText || 'Request failed';

      notifier.notify('error', `${message} (status: ${status})`);

      return throwError(() => error);
    }),
  );
};
