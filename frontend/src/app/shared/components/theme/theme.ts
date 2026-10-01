import { TitleCasePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, output, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import { MatOption } from '@angular/material/core';
import { MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel } from '@angular/material/input';
import { MatSelect, MatSelectTrigger } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { NotifierService } from 'angular-notifier';
import { catchError, debounceTime, distinctUntilChanged, filter, from, Observable, switchMap, take, tap } from 'rxjs';
import { ThemeConfigFormModel } from '../../models/theme.model';
import { ThemeColors } from '../../models/ui-config.model';
import { HttpService } from '../../services/http.service';
import { UiConfigService } from '../../services/ui-config.service';
import { SECTION_OPTIONS } from './theme.constants';
import { TargetIconPipe } from './target-icon.pipe';

@Component({
  selector: 'rt-theme',
  imports: [
    FormsModule,
    MatCard,
    MatCardContent,
    MatCardHeader,
    MatCardTitle,
    MatFormField,
    MatLabel,
    MatOption,
    MatSelect,
    ReactiveFormsModule,
    TitleCasePipe,
    MatSlideToggle,
    MatIcon,
    MatTooltip,
    MatPrefix,
    MatSelectTrigger,
    TargetIconPipe,
  ],
  templateUrl: './theme.html',
  styleUrls: ['./theme.css'],
})
export class Theme implements OnInit {
  private readonly _fb = new FormBuilder();
  private readonly _http = inject(HttpService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _uiConfig = inject(UiConfigService);
  private readonly _notifier = inject(NotifierService);

  readonly sectionOptions = SECTION_OPTIONS;
  readonly themeColorOptions = Object.values(ThemeColors);

  closeDialog = output<void>();

  autoPasteToggle = viewChild<MatSlideToggle>('autoPasteToggle');

  /**
   * Seeded from the live config rather than from fixed defaults, so reopening
   * the dialog shows what is actually applied instead of resetting the selects
   * to values the user never picked.
   */
  form = this._fb.group<ThemeConfigFormModel>({
    themeColor: this._fb.control(this._uiConfig.config().themeColor, { nonNullable: true }),
    sectionsBg: this._fb.control(this._uiConfig.config().sectionsBg, { nonNullable: true }),
    enableAnimations: this._fb.control(this._uiConfig.config().enableAnimations, { nonNullable: true }),
    autoPaste: this._fb.control(this._uiConfig.config().autoPaste, { nonNullable: true }),
  });

  ngOnInit() {
    /**
     * One subscription for the whole form instead of one per control: every
     * field feeds the same config object, and applying the change immediately
     * makes the dialog a live preview - you see the colour before committing.
     */
    this.form.valueChanges
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        tap((value) => this._uiConfig.update(value)),
        debounceTime(600),
        distinctUntilChanged((a, b) => JSON.stringify(a.enableAnimations) === JSON.stringify(b.enableAnimations)),
        switchMap((value) => this._http.saveUiConfig(value)),
      )
      .subscribe();
  }

  trackAutoPaste(checked: boolean) {
    const message = 'Permission denied to read clipboard.';

    this.form.controls.autoPaste.setValue(checked);

    this._getAutoPastePermission()
      .pipe(
        take(1),
        tap((permission) => {
          this.form.controls.autoPaste.setValue(checked ? permission?.state === 'granted' : false);
          if (checked && permission?.state === 'denied') throw new Error(message);
        }),
        filter((permission) => (checked ? permission?.state === 'prompt' : false)),
        switchMap(() => from(navigator.clipboard.readText())),
        tap(() => this.form.controls.autoPaste.setValue(true)),
        catchError((err) => {
          this.form.controls.autoPaste.setValue(false);
          this.autoPasteToggle().checked = false;
          this._notifier.notify('error', message);
          return err;
        }),
      )
      .subscribe();
  }

  private _getAutoPastePermission(): Observable<PermissionStatus> {
    return from(navigator.permissions.query({ name: 'clipboard-read' as PermissionName }));
  }

  /** Config is already applied; this only dismisses. Persisting waits for the BE. */
  saveConfig() {
    this.closeDialog.emit();
  }
}
