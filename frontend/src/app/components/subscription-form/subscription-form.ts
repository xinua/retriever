import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  FormGroupDirective,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButton } from '@angular/material/button';
import { MatCard, MatCardContent, MatCardHeader, MatCardSubtitle, MatCardTitle } from '@angular/material/card';
import { MatOption } from '@angular/material/core';
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelDescription,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle,
} from '@angular/material/expansion';
import { MatIcon } from '@angular/material/icon';
import { MatError, MatFormField, MatHint, MatInput, MatLabel, MatSuffix } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTimepicker, MatTimepickerInput, MatTimepickerToggle } from '@angular/material/timepicker';
import { MatTooltip } from '@angular/material/tooltip';
import { AudioFormatLabels, CodecLabels, DefaultSubscription, VideoFormatLabels } from '@shared/constants';
import { equalJson } from '@shared/helpers';
import {
  AudioFormats,
  ChannelFormModel,
  Codecs,
  PollType,
  SubscriptionModel,
  Types,
  VideoFormats,
} from '@shared/models';
import { HttpService, SnackbarType, StorageService } from '@shared/services';
import { RtValidators } from '@shared/validators';
import { NotifierService } from 'angular-notifier';
import { catchError, combineLatest, map, Observable, of, startWith, tap } from 'rxjs';
import { TimeFormat, TimePipe } from '../../shared/pipes/time.pipe';

@Component({
  selector: 'rt-subscription-form',
  imports: [
    AsyncPipe,
    MatAutocompleteModule,
    FormsModule,
    MatAccordion,
    MatButton,
    MatCard,
    MatCardContent,
    MatCardHeader,
    MatCardSubtitle,
    MatCardTitle,
    MatError,
    MatExpansionPanel,
    MatExpansionPanelDescription,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
    MatFormField,
    MatHint,
    MatIcon,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
    MatSlideToggle,
    ReactiveFormsModule,
    MatSuffix,
    MatTimepickerToggle,
    MatTimepickerInput,
    MatTimepicker,
    MatTooltip,
    TimePipe,
  ],
  templateUrl: './subscription-form.html',
  styleUrl: './subscription-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubscriptionForm implements OnInit {
  private readonly _fb = new FormBuilder();
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _httpService = inject(HttpService);
  private readonly _storage = inject(StorageService);
  private readonly _formDirective = viewChild<FormGroupDirective>(FormGroupDirective);
  private readonly _notifier = inject(NotifierService);

  protected readonly defaultChannel = DefaultSubscription;
  globalWebhookURL = computed((): string => this._storage.settings().webhookUrl);
  globalWebhookURL$ = toObservable(this.globalWebhookURL);

  form!: FormGroup<ChannelFormModel>;
  isSaving = signal(false);
  isEditing = computed(() => !!this._storage.editingSubscription());
  /** Folders on disk under the downloads root, plus every subscription tag. */
  folders = this._storage.folderOptions;

  readonly codecs = Codecs;
  readonly types = Types;
  readonly videoFormats = VideoFormats;
  readonly audioFormats = AudioFormats;
  readonly videoFormatLabels = VideoFormatLabels;
  readonly audioFormatLabels = AudioFormatLabels;
  readonly codecLabels = CodecLabels;
  readonly pollType = PollType;
  readonly TimeFormat = TimeFormat;
  formatOptions$: Observable<VideoFormats[] | AudioFormats[]>;
  codecOptions = Object.values(this.codecs);

  constructor() {
    this._trackChannel();

    this.form = this._fb.group<ChannelFormModel>({
      id: this._fb.control(null),
      name: this._fb.control(null),
      rssUrl: this._fb.control('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^https?:\/\//)],
      }),
      type: this._fb.control(Types.VIDEO, { nonNullable: true, validators: Validators.required }),
      format: this._fb.control(this.videoFormats.AUTO, { nonNullable: true, validators: Validators.required }),
      codec: this._fb.control(this.codecs.AUTO),
      ytdlpArgs: this._fb.control(null),
      startFromLast: this._fb.control(true, { nonNullable: true, validators: Validators.required }),
      downloadShorts: this._fb.control(false, {
        nonNullable: true,
        validators: Validators.required,
      }),
      notifyHA: this._fb.control(false, { nonNullable: true, validators: Validators.required }),
      webhookOverride: this._fb.control({ value: '', disabled: true }),
      prefix: this._fb.control(''),
      tag: this._fb.control(''),
      pollType: this._fb.control(PollType.INTERVAL, {
        nonNullable: true,
        validators: [Validators.required],
      }),
      pollInterval: this._fb.control(null, {
        nonNullable: false,
        validators: [Validators.required, Validators.min(1), Validators.max(1440)],
      }),
      pollTime: this._fb.control(null),
    });

    this.formatOptions$ = this.form.controls.type.valueChanges.pipe(
      startWith(this.form.controls.type.value),
      map(() =>
        this.form.controls.type.value === Types.VIDEO
          ? Object.values(this.videoFormats)
          : Object.values(this.audioFormats),
      ),
      takeUntilDestroyed(this._destroyRef),
    );
  }

  ngOnInit() {
    this._httpService.getFolders().subscribe();
    this._trackWebhook();
    this._trackPollType();
    this._trackType();
  }

  save(subscription: Partial<SubscriptionModel>) {
    const isEdditing = !!subscription?.id;
    this.isSaving.set(true);
    const request = (isEdditing ? this._httpService.updateSubscription : this._httpService.addSubscription).bind(this._httpService);

    request(this.form.value as SubscriptionModel).subscribe({
      next: (channel: SubscriptionModel) => {
        this._updateChannels(channel);
        this.resetForm();
        this._storage.showForm.set(false);
        if (!channel.startFromLast) {
          this._notifier.notify('success', 'Subscription saved successfully');
        }
      },
      error: () => {
        this.form.updateValueAndValidity();
        this.isSaving.set(false);
        this._notifier.notify('error', 'Something went wrong');
      },
    });
  }

  resetForm(): void {
    this._storage.editingSubscription.set(null);
    this.form.clearValidators();
    this._formDirective()?.resetForm(DefaultSubscription);
  }

  closeForm() {
    this._storage.showForm.set(false);
  }

  copyToClipboard(value: string) {
    navigator.clipboard.writeText(value);
    this._notifier.notify('success', 'Copied to clipboard');
  }

  sendWebhook() {
    if (!this.form.value.webhookOverride?.length) return;
    this._httpService
      .sendWebhook(this.form.value.webhookOverride)
      .pipe(
        tap((response) => {
          const message = response.ok ? 'Webhook sent successfully.' : 'Failed to send webhook.';
          const type = response.ok ? SnackbarType.SUCCESS : SnackbarType.ERROR;
          this._notifier.notify(type, message);
        }),
        catchError(() => {
          this._notifier.notify('error', 'Failed to send webhook.');
          return of({ ok: false });
        }),
      )
      .subscribe();
  }

  /**
   * Control "required" validator for webhookOverride control\
   * Add/Remove validator if global webhook was added/deleted while editing/adding a channel
   */
  private _trackWebhook() {
    combineLatest([this.form.controls.notifyHA.valueChanges, this.globalWebhookURL$])
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        map(([_, globalWebhook]): boolean[] => [_, !globalWebhook?.length]),
      )
      .subscribe(([shouldNotify, shouldValidate]) => {
        this.form.controls.webhookOverride[shouldNotify ? 'enable' : 'disable']();
        this.form.controls.webhookOverride[shouldValidate && shouldNotify ? 'addValidators' : 'removeValidators']([
          Validators.required,
          RtValidators.url,
        ]);
        this.form.controls.webhookOverride.updateValueAndValidity();
      });
  }

  private _trackPollType() {
    this.form.controls.pollType.valueChanges
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        map((pollType) => pollType === PollType.INTERVAL),
      )
      .subscribe((isInterval) => {
        this.form.controls.pollInterval[isInterval ? 'addValidators' : 'removeValidators']([
          Validators.required,
          Validators.min(1),
          Validators.max(1440),
        ]);
        this.form.controls.pollTime[isInterval ? 'removeValidators' : 'addValidators']([Validators.required]);
        this.form.controls.pollInterval.updateValueAndValidity();
        this.form.controls.pollTime.updateValueAndValidity();
      });
  }

  // todo - update to track other tabs
  private _trackChannel() {
    effect((): void => {
      // If the channel was deleted while editing, close the form
      const isChannelExists = !this._storage
        .subscriptions()
        .find((c) => c.id === this._storage.editingSubscription()?.id);

      if (this._storage.editingSubscription() && isChannelExists) {
        this.closeForm();
        return;
      }

      this._trackIsEditing();

      this.form.updateValueAndValidity();
    });
  }

  private _trackIsEditing() {
    // On channel edit, patch the form with the new values
    if (this._storage.editingSubscription()) {
      this.form.patchValue(this._storage.editingSubscription());
      this.form.addValidators(RtValidators.formChanged(this.form.value, equalJson));
    } else {
      this.form.clearValidators();
      this.form.reset(DefaultSubscription);
    }
  }

  private _trackType() {
    this.form.controls.type.valueChanges
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        tap((type) => {
          if (type === Types.AUDIO) {
            this.form.controls.codec.reset(null);
            this.form.controls.format.reset(this.audioFormats.MP3);
            this.form.controls.codec.disable();
          } else {
            this.form.controls.format.reset(this.videoFormats.AUTO);
            this.form.controls.codec.enable();
            this.form.controls.codec.reset(this.codecs.AUTO);
          }
        }),
      )
      .subscribe();
  }

  private _updateChannels(channel: SubscriptionModel) {
    if (this.isEditing()) {
      this._storage.subscriptions.set(
        this._storage.subscriptions().map((c) => (c.id === channel.id ? channel : c)) as SubscriptionModel[],
      );
    } else {
      this._storage.subscriptions.set([...this._storage.subscriptions(), channel] as SubscriptionModel[]);
    }
  }
}
