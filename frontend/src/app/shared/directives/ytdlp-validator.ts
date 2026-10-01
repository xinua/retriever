import { Directive, inject } from '@angular/core';
import { AbstractControl, AsyncValidator, NG_ASYNC_VALIDATORS, ValidationErrors } from '@angular/forms';
import { catchError, debounceTime, map, Observable, of, startWith, switchMap, take } from 'rxjs';
import { HttpService } from '../services/http.service';

/**
 * Checks the yt-dlp binary and the downloads directory currently in the form,
 * plus the saved cookies file.
 */
@Directive({
  selector: '[rtYtdlpValidator]',
  providers: [{ provide: NG_ASYNC_VALIDATORS, useExisting: YtdlpValidatorDirective, multi: true }],
})
export class YtdlpValidatorDirective implements AsyncValidator {
  private readonly _httpService = inject(HttpService);

  validate(control: AbstractControl): Observable<ValidationErrors | null> {
    const form = control.parent;

    return control.valueChanges.pipe(
      startWith(control.value),
      debounceTime(600),
      switchMap(() => this._httpService.validateYtdlp(form?.get('downloadsDir')?.value)),
      map((response) =>
        response.status ? null : { invalidYtdlp: true, message: response.error ?? 'yt-dlp not ready' },
      ),
      take(1),
      catchError((error) => {
        console.error(error);
        return of({ invalidYtdlp: true, message: 'yt-dlp not ready' });
      }),
    );
  }
}
