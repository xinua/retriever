import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatAutocomplete, MatAutocompleteTrigger, MatOption } from '@angular/material/autocomplete';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCard, MatCardContent, MatCardHeader, MatCardSubtitle, MatCardTitle } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIcon } from '@angular/material/icon';
import { MatError, MatFormField, MatHint, MatInput, MatLabel, MatSuffix } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggle, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatStepperModule } from '@angular/material/stepper';
import { MatTooltip } from '@angular/material/tooltip';
import { NotifierService } from 'angular-notifier';
import { catchError, finalize, of, tap } from 'rxjs';
import {
  notifyAutomationExample,
  notifyWebhookExample,
  playDownloadAutomationExample,
  playWebhookExample,
  WIDGET_CODE,
} from '../../constants/code.const';
import { DRAG_TOKEN } from '../../constants/drag-token';
import { DisableStepDirective } from '../../directives/disable-step.directive';
import { browserTimeZone, supportedTimeZones } from '../../helpers/common.helpers';
import { createDragObservable } from '../../helpers/factory.helpers';
import { formatNotifyAutomation, formatPlayDownloadAutomation } from '../../helpers/settings.helpers';
import { PotStatusModel, SettingsFormModel, SettingsModel } from '../../models/settings.model';
import { HttpService } from '../../services/http.service';
import { StorageService } from '../../services/storage.service';
import { RtValidators } from '../../validators/rt.validators';
import { Code } from '../code/code';
import { TelegramChats } from '../telegram-chats/telegram-chats';

interface CodeExample {
  value: string;
  name: string;
  code: string;
}

interface CodeExamples {
  webhooks: CodeExample[];
  automations: CodeExample[];
  widget: CodeExample;
}

const codeExamples: CodeExamples = {
  webhooks: [
    {
      value: 'notifyWebhook',
      name: 'Notify Webhook',
      code: notifyWebhookExample,
    },
    {
      value: 'playWebhook',
      name: 'Play Webhook',
      code: playWebhookExample,
    },
  ],
  automations: [
    {
      value: 'notifyAutomation',
      name: 'Notify Automation',
      code: notifyAutomationExample,
    },
    {
      value: 'playAutomation',
      name: 'Play Automation',
      code: playDownloadAutomationExample,
    },
  ],
  widget: {
    value: 'cardWidget',
    name: 'Card widget',
    code: WIDGET_CODE(window.location.origin, 1),
  },
};

@Component({
  selector: 'rt-app-settings',
  imports: [
    MatSlideToggleModule,
    MatStepperModule,
    ReactiveFormsModule,
    FormsModule,
    MatButton,
    MatCard,
    MatCardContent,
    MatCardHeader,
    MatCardSubtitle,
    MatCardTitle,
    MatFormField,
    MatHint,
    MatIcon,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
    MatError,
    MatSuffix,
    MatTooltip,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
    MatSlideToggle,
    TelegramChats,
    DisableStepDirective,
    MatIconButton,
    NgTemplateOutlet,
    MatExpansionModule,
    Code,
    MatSelectModule,
  ],
  providers: [
    {
      provide: DRAG_TOKEN,
      useValue: createDragObservable(),
    },
  ],
  templateUrl: './app-settings.html',
  styleUrl: './app-settings.css',
})
export class AppSettings {
  private readonly _fb = new FormBuilder();
  private readonly _httpService = inject(HttpService);
  private readonly _storage = inject(StorageService);
  private readonly _notifier = inject(NotifierService);
  private _changedValidator?: ValidatorFn;
  closeDialog = output<void>();

  ytdlpVersion = signal<string | null>(null);
  isUpdating = signal(false);
  showToken = signal(false);

  /** Saved straight away by its own endpoint, so it lives outside the form. */
  cookiesPath = signal<string | null>(null);
  isUploadingCookies = signal(false);
  readonly cookiesFileName = computed(() => this.cookiesPath()?.split(/[\\/]/).pop() ?? '');

  code = codeExamples;
  selectedWebhook = signal<CodeExample>(codeExamples.webhooks[0]);
  selectedAutomation = signal<CodeExample>(codeExamples.automations[0]);

  /**
   * Null until the check comes back, and stays hidden unless a provider is
   * actually configured — the POT provider is opt-in, so for most installs
   * there is nothing worth saying.
   */
  potStatus = signal<PotStatusModel | null>(null);
  tgIsLocal = computed<boolean>(() => !!this._storage.telegramStatus()?.local);

  readonly browserTimeZone = browserTimeZone();
  private readonly _timeZones = supportedTimeZones();
  private readonly _knownTimeZones = new Set(this._timeZones);

  form = this._fb.group<SettingsFormModel>({
    webhookUrl: this._fb.control('', { validators: [RtValidators.url] }),
    downloadsDir: this._fb.control('./'),
    ytdlpArgs: this._fb.control(''),
    ytdlpConcurrency: this._fb.control(2, {
      nonNullable: true,
      validators: [Validators.min(1), Validators.max(10)],
    }),
    timeZone: this._fb.control<string | null>(null, {
      validators: [(control) => this._validateTimeZone(control)],
    }),
    embedVideoCover: this._fb.control(false, { nonNullable: true }),
    telegramEnabled: this._fb.control(false, { nonNullable: true }),
    telegramBotToken: this._fb.control<string | null>(null),
    telegramApiUrl: this._fb.control<string | null>(null, { validators: [RtValidators.url] }),
    telegramKeepFiles: this._fb.control(false, { nonNullable: true }),
    notifyDownloadFailed: this._fb.control(false, { nonNullable: true }),
  });

  private readonly _timeZoneQuery = toSignal(this.form.controls.timeZone.valueChanges, { initialValue: null });

  /** Zones matching what has been typed, capped so the panel stays quick to render. */
  readonly timeZoneOptions = computed(() => {
    const query = (this._timeZoneQuery() ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    const matches = query ? this._timeZones.filter((zone) => zone.toLowerCase().includes(query)) : this._timeZones;

    return matches.slice(0, 50);
  });

  isTelegramEnabled = toSignal(this.form.controls.telegramEnabled.valueChanges, {
    initialValue: this.form.controls.telegramEnabled.value,
  });

  steps = computed(() => [
    { index: 2, enabled: this.potStatus()?.configured },
    { index: 3, enabled: this.isTelegramEnabled() },
  ]);
  isUpdated = signal(false);

  ngOnInit() {
    this._httpService.getSettings().subscribe((settings) => {
      this.cookiesPath.set(settings.cookiesPath);
      this.form.patchValue(settings);
      this._resetValidators();
      this.form.updateValueAndValidity();
      this._formatAutomations(settings.webhookUrl ?? '');
    });

    this._loadVersion();
    this._loadPotStatus();
  }

  private _formatAutomations(webhook: string) {
    this.code.automations.forEach((automation) => {
      if (automation.value === 'notifyAutomation') {
        automation.code = formatNotifyAutomation(automation.code, webhook);
      } else if (automation.value === 'playAutomation') {
        automation.code = formatPlayDownloadAutomation(automation.code, webhook);
      }
    });
  }

  showUpdated() {
    this.isUpdated.set(true);
    setTimeout(() => this.isUpdated.set(false), 2000);
  }

  useBrowserTimeZone() {
    this.form.controls.timeZone.setValue(this.browserTimeZone);
    this.form.controls.timeZone.markAsDirty();
  }

  saveSettings() {
    // Empty means "no zone saved": the server then falls back to its own clock.
    const timeZone = this.form.value.timeZone?.trim() || null;

    this._httpService
      .saveSettings({ ...this._storage.settings(), ...this.form.value, timeZone } as SettingsModel)
      .pipe(
        tap((settings: SettingsModel) => this._storage.settings.set(settings)),
        tap(() => this._resetValidators()),
      )
      .subscribe({
        next: () => this._notifier.notify('success', 'Settings saved successfully.'),
        error: () => this._notifier.notify('error', 'Failed to save settings.'),
      });
  }

  uploadCookies(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Cleared so picking the same file again still fires a change.
    input.value = '';

    if (!file) return;

    this.isUploadingCookies.set(true);

    this._httpService
      .uploadCookies(file)
      .pipe(finalize(() => this.isUploadingCookies.set(false)))
      .subscribe({
        next: (settings) => {
          this._applyCookies(settings);
          this._notifier.notify('success', 'Cookies file uploaded.');
        },
        error: (e) => this._notifier.notify('error', e?.error?.error ?? 'Failed to upload cookies file.'),
      });
  }

  removeCookies() {
    this._httpService.removeCookies().subscribe({
      next: (settings) => {
        this._applyCookies(settings);
        this._notifier.notify('success', 'Cookies file removed.');
      },
      error: () => this._notifier.notify('error', 'Failed to remove cookies file.'),
    });
  }

  updateYtdlp() {
    this.isUpdating.set(true);

    this._httpService
      .updateYtdlp()
      .pipe(
        catchError(() => of({ ok: false, from: null, to: null, output: 'Update request failed' })),
        tap(() => this.isUpdating.set(false)),
      )
      .subscribe((result) => {
        this.ytdlpVersion.set(result.to ?? result.from);

        if (!result.ok) {
          this._notifier.notify('error', `yt-dlp update failed: ${result.output.slice(0, 160)}`);
          return;
        }

        const message =
          result.from === result.to
            ? `yt-dlp is already up to date (${result.to}).`
            : `yt-dlp updated: ${result.from} → ${result.to}`;

        this._notifier.notify('success', message);
      });
  }

  sendWebhook() {
    if (!this.form.value.webhookUrl?.length) return;
    this._httpService
      .sendWebhook(this.form.value.webhookUrl)
      .pipe(
        tap((response) => {
          if (response.ok) {
            this._notifier.notify('success', 'Notify webhook sent successfully.', 'webhookOk');
          } else {
            this._notifier.notify('error', 'Failed to send webhook.');
          }
        }),
        catchError(() => {
          this._notifier.notify('error', 'Failed to send webhook.');
          return of({ ok: false });
        }),
      )
      .subscribe();
  }

  trackByValue(item: { value: string }) {
    return item.value;
  }

  /** The health check reads the saved cookies, so re-run it against the new file. */
  private _applyCookies(settings: SettingsModel) {
    this.cookiesPath.set(settings.cookiesPath);
    this._storage.settings.update((current) => ({ ...current, cookiesPath: settings.cookiesPath }));
    this.form.controls.downloadsDir.updateValueAndValidity();
  }

  private _validateTimeZone(control: AbstractControl<string | null>): ValidationErrors | null {
    const value = control.value?.trim();
    return !value || this._knownTimeZones.has(value) ? null : { unknownTimeZone: true };
  }

  private _loadVersion() {
    this._httpService
      .getYtdlpVersion()
      .pipe(catchError(() => of({ version: null, available: false })))
      .subscribe((result) => this.ytdlpVersion.set(result.version));
  }

  private _loadPotStatus() {
    this._httpService
      .getPotStatus()
      .pipe(catchError(() => of(null)))
      // .pipe(map(() => ({ configured: true, ok: true, version: '1.0.0', baseUrl: 'https://example.com', error: null })), catchError(() => of(null)))
      .subscribe((status) => this.potStatus.set(status));
  }

  private _resetValidators() {
    if (this._changedValidator) this.form.removeValidators(this._changedValidator);
    this._changedValidator = RtValidators.formChanged(this.form.getRawValue(), true);
    this.form.addValidators(this._changedValidator);
    this.form.updateValueAndValidity();
  }
}
