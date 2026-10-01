import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { equalJson } from '../helpers/common.helpers';

export class RtValidators {
  static formChanged<T extends object>(sourceValue: T, compareRaw = false): ValidatorFn {
    const compareWith: T = window.structuredClone(sourceValue);
    return (form: AbstractControl | FormGroup): ValidationErrors | null =>
      equalJson(compareRaw ? form.getRawValue() : form.value, compareWith) ? { unchanged: true } : null;
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
