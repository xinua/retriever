import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

export const DRAG_TOKEN = new InjectionToken<Observable<boolean>>('drag');
