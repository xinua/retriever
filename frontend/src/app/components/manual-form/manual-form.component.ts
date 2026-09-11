import { TitleCasePipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCardModule } from '@angular/material/card';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle,
} from '@angular/material/expansion';
import { MatError, MatPrefix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatInput, MatLabel, MatSuffix } from '@angular/material/input';
import { MatOption, MatSelect, MatSelectTrigger } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import {
  AudioFormats,
  Codecs,
  HomeSection,
  ManualFormModel,
  ManualDownloadRequest,
  VideoQuality,
  Types,
  VideoFormats,
  AudioQuality,
} from '@shared/models';
import { HttpService, LayoutService, ScrollToService, StorageService } from '@shared/services';
import { RtValidators } from '@shared/validators';
import { NotifierService } from 'angular-notifier';
import { catchError, filter, from, map, Observable, of, skip, tap } from 'rxjs';
import { finalize, startWith, take } from 'rxjs/operators';
import { CODEC_ICONS, FORMAT_ICONS, QUALITY_ICONS, TYPE_ICONS } from './manual-form.constants';
import { DefaultManualForm } from '@shared/constants';

@Component({
  selector: 'rt-manual-form',
  templateUrl: './manual-form.component.html',
  styleUrls: ['./manual-form.component.css'],
  imports: [
    FormsModule,
    MatCardModule,
    MatIcon,
    MatSuffix,
    MatPrefix,
    MatInput,
    MatLabel,
    MatError,
    MatFormField,
    ReactiveFormsModule,
    MatTooltip,
    MatSelect,
    MatOption,
    TitleCasePipe,
    MatSelectTrigger,
    MatAccordion,
    MatExpansionPanel,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
    MatAutocompleteModule,
    MatCheckbox,
  ],
})
export class ManualFormComponent implements OnInit, AfterViewInit {
  private readonly _fb = inject(FormBuilder);
  private readonly _storage = inject(StorageService);
  private readonly _http = inject(HttpService);
  private readonly _notifier = inject(NotifierService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _scrollTo = inject(ScrollToService);
  private readonly _layout = inject(LayoutService);

  readonly typesEnum = Types;
  readonly types = Object.values(Types);
  readonly codecs = Object.values(Codecs);

  readonly videoFormats = Object.values(VideoFormats);
  readonly audioFormats = Object.values(AudioFormats);
  readonly videoQualities = Object.values(VideoQuality);
  readonly audioQualities = Object.values(AudioQuality);

  readonly typeIcons = TYPE_ICONS;
  readonly codecIcons = CODEC_ICONS;
  readonly formatIcons = FORMAT_ICONS;
  readonly qualityIcons = QUALITY_ICONS;

  formats = signal<(VideoFormats | AudioFormats)[]>(this.videoFormats);
  qualities = signal<(VideoQuality | AudioQuality)[]>(this.videoQualities);

  isPending = signal(false);
  isSubmitted = signal(false);

  form!: FormGroup<ManualFormModel>;

  urlInput = viewChild<ElementRef<HTMLInputElement>>('urlInput');
  urlMatInput = viewChild<MatFormField>('urlMatInput');

  folders = this._storage.folderOptions;
  currentColor = computed(() => this._storage.uiConfig().themeColor);

  constructor() {
    this.form = this._fb.group<ManualFormModel>({
      url: new FormControl('', [RtValidators.url]),
      quality: new FormControl(VideoQuality.BEST),
      type: new FormControl(Types.VIDEO),
      format: new FormControl(this.videoFormats[0]),
      codec: new FormControl(Codecs.AUTO),
      ytdlpArgs: new FormControl(''),
      prefix: new FormControl(''),
      destinationFolder: new FormControl(''),
      clipStart: new FormControl(''),
      clipEnd: new FormControl(''),
      removeSponsor: new FormControl(false),
      splitChapters: new FormControl(false),
    });

    effect(() => {
      if (this.urlInput()?.nativeElement?.focus) this.pasteUrl();
      if (this._storage.uiConfig().autoPaste) this.urlInput()?.nativeElement?.focus();
    });
  }

  ngOnInit(): void {
    this.form.patchValue(this._storage.manualDownloadForm());
  }

  ngAfterViewInit(): void {
    this._http.getFolders().subscribe();
    this.trackFormChanges();
    this._trackTypeChange().subscribe((type) => this._syncFormats(type));
  }

  trackFormChanges() {
    this.form.valueChanges
      .pipe(
        skip(1),
        map(({ quality, type, format, codec }) => ({ quality, type, format, codec })),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(({ quality, type, format, codec }) => {
        this._storage.manualDownloadForm.set({ ...DefaultManualForm, quality, type, format, codec });
      });
  }

  download(): void {
    if (this.isPending()) return;

    this.isSubmitted.set(true);

    if (this.form.controls.url.value.trim() === '' && this._storage.uiConfig().autoPaste) {
      from(navigator.clipboard.readText())
        .pipe(take(1))
        .subscribe((text) => {
          this.form.controls.url.setValue(text);
          this.download();
        });
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isPending.set(true);

    this._http
      .createDownload(this._toRequest())
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        finalize(() => this.isPending.set(false)),
      )
      .subscribe({
        next: (result) => {
          if (this._layout.sectionOrder()[0] !== HomeSection.DOWNLOADS) this._scrollTo.scrollTo('downloads');

          // The server also broadcasts these rows; merging by id keeps the
          // response and the broadcast from producing two cards each.
          this._storage.upsertDownloads(result.downloads);

          this._notifier.notify(
            'success',
            this._queuedMessage(result.queued, result.kind, result.truncated, result.limit),
          );

          this.isSubmitted.set(false);
          this.form.controls.url.reset('');
          this.urlInput()?.nativeElement?.focus();
        },
        error: (error) => this._notifier.notify('error', error?.error?.error ?? 'The server rejected the request'),
      });
  }

  pasteUrl(): void {
    if (this._storage.uiConfig().autoPaste && this.urlInput()?.nativeElement?.value === '') {
      from(navigator.clipboard.readText())
        .pipe(
          take(1),
          filter((text) => RtValidators.validateUrl(text)),
          tap((text) => this.form.controls.url.setValue(text)),
          catchError(() => of(null)),
        )
        .subscribe();
    }
  }

  private _trackTypeChange(): Observable<Types> {
    return this.form.controls.type.valueChanges.pipe(
      takeUntilDestroyed(this._destroyRef),
      startWith(this.form.controls.type.value),
      tap((type) => this._disableControls(type)),
    );
  }

  /**
   * Video and audio have separate format and quality lists, and a thumbnail
   * has neither — it is always a jpg. Switching type must therefore land on
   * values that belong to the new type, or the request would be rejected.
   */
  private _syncFormats(type: Types): void {
    if (type === Types.THUMBNAIL) return;

    const formats = type === Types.VIDEO ? this.videoFormats : this.audioFormats;
    const qualities = type === Types.VIDEO ? this.videoQualities : this.audioQualities;

    this.formats.set(formats);
    this.qualities.set(qualities);

    this._keepOrReset(this.form.controls.format, formats);
    this._keepOrReset(this.form.controls.quality, qualities);
  }

  private _disableControls(type: Types): void {
    const isThumbnail = type === Types.THUMBNAIL;

    this.form.controls.clipStart[isThumbnail ? 'disable' : 'enable']();
    this.form.controls.clipEnd[isThumbnail ? 'disable' : 'enable']();
    this.form.controls.removeSponsor[isThumbnail ? 'disable' : 'enable']();
    this.form.controls.splitChapters[isThumbnail ? 'disable' : 'enable']();
  }

  /**
   * Resetting only what the new type cannot express, rather than resetting
   * unconditionally. patchValue() applies the saved form key by key and each
   * one emits, so restoring an audio form set `quality` and then `type` —
   * and the type change wiped the quality that was just restored. Both lists
   * spell "best" the same way, so that choice also survives a type switch.
   */
  private _keepOrReset<T>(control: FormControl<T>, allowed: T[]): void {
    if (!allowed.includes(control.value)) control.setValue(allowed[0]);
  }

  private _toRequest(): ManualDownloadRequest {
    const value = this.form.getRawValue();
    const trim = (input: string): string | null => input?.trim() || null;

    return {
      url: value.url.trim(),
      type: value.type,
      format: value.format,
      codec: value.codec,
      quality: value.quality,
      folder: trim(value.destinationFolder),
      // A prefix may legitimately end in a space ("Channel - ").
      prefix: value.prefix?.length ? value.prefix : null,
      ytdlpArgs: trim(value.ytdlpArgs),
      clipStart: trim(value.clipStart),
      clipEnd: trim(value.clipEnd),
      removeSponsor: value.removeSponsor,
      splitChapters: value.splitChapters,
    };
  }

  private _queuedMessage(queued: number, kind: string, truncated: boolean, limit: number): string {
    if (kind === 'video') return 'Download queued';

    const capped = truncated ? ` (capped at ${limit})` : '';

    return `Queued ${queued} video${queued === 1 ? '' : 's'} from this ${kind}${capped}`;
  }
}
