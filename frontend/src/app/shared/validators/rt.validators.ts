import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';

export class RtValidators {
  static formChanged<T>(sourceValue: T, compareFn: (source: T, formValue: T) => boolean): ValidatorFn {
    const compareWith: T = window.structuredClone(sourceValue);
    return ((form: FormGroup): ValidationErrors =>
      compareFn(form.value, compareWith) ? { unchanged: true } : null) as ValidatorFn;
  }

  static url(control: AbstractControl): ValidationErrors | null {
    const message = 'URL must start with http:// or https://';
    const url = control.value;
    if (!url) return null;
    if (!RtValidators.validateUrl(url)) return { invalidUrl: true, message };
    return null;
  }

  static validateUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }
}
