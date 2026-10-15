import {
  AfterContentInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ControlValueAccessor,
  FormControl,
  FormGroupDirective,
  NgControl,
  NgForm,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { MatAutocomplete, MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { ErrorStateMatcher, MatOption } from '@angular/material/core';
import {
  MatError,
  MatFormFieldAppearance,
  MatFormFieldModule,
  MatHint,
  MatSuffix,
  SubscriptSizing,
} from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MAT_MENU_PANEL } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { catchError, debounceTime, filter, map, Observable, of, shareReplay, switchMap } from 'rxjs';
import { Nullable } from '../../models/common.model';
import { FolderEntryModel, FolderListingModel } from '../../models/settings.model';
import { HttpService } from '../../services/http.service';
import { StorageService } from '../../services/storage.service';

interface PathOption extends FolderEntryModel {
  /** What lands in the field when picked: the typed folder plus this entry. */
  value: string;
  /** Whether this is the downloads folder from Settings ("here") or a folder on the way to it ("inside"). */
  downloads: Nullable<'here' | 'inside'>;
  /** What the option's tooltip says; empty for a plain entry. */
  tooltip: string;
}

interface Listing {
  /** The folder that was asked for, as split from the field. */
  dir: string;
  /** Null when the folder does not exist (or cannot be read). */
  listing: Nullable<FolderListingModel>;
}

/**
 * A dot opening a name: hidden files and folders are never offered, and "."
 * and ".." mean nothing in a path that is always taken from the root.
 */
const LEADING_DOTS = /(^|[\\/])\.+/g;

/**
 * Splits the field at its last slash: the folder before it is listed, the
 * rest filters that listing. `anime/Na` lists `anime` and keeps what starts
 * with or contains `Na`. A leading slash means nothing — paths are always
 * taken from the mounted root.
 */
export function splitPath(value: string): { base: string; dir: string; filter: string } {
  const slash = value.search(/[\\/][^\\/]*$/);
  const base = slash < 0 ? '' : value.slice(0, slash + 1);

  return {
    base,
    dir: base
      .split(/[\\/]+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/'),
    filter: value.slice(base.length),
  };
}

/** Where the downloads folder is relative to the folder at `path`; both relative to the root. */
function downloadsAt(path: string, downloads: string): PathOption['downloads'] {
  if (!downloads) return null;
  if (downloads === path) return 'here';

  return downloads.startsWith(`${path}/`) ? 'inside' : null;
}

function tooltipFor(downloads: PathOption['downloads'], mount: boolean): string {
  return [
    downloads === 'here' ? 'Downloads folder' : downloads === 'inside' ? 'Downloads folder is inside' : '',
    mount ? 'Separate filesystem (dataset or disk)' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A path inside the mounted root, typed with one level of the folder tree
 * offered at a time: picking a folder fills it in with a trailing slash and
 * shows what is inside, so a deep path is reached by picking, not typing.
 *
 * Used as a form control (`formControlName`, `ngModel`); validators placed on
 * it, such as `rtYtdlpValidator`, apply as usual and their `message` is shown
 * as the error.
 *
 * With `defaultFolder` set, an empty field stands for that folder (the
 * downloads folder setting) and "/" picks the root explicitly; the server
 * resolves both. Without it the value is taken literally.
 */
@Component({
  selector: 'rt-path-input',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatHint,
    MatError,
    MatSuffix,
    MatInput,
    MatIcon,
    MatTooltip,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
  ],
  templateUrl: './path-input.html',
  styles: [
    `
      .path-input .mat-mdc-option.mdc-list-item {
        padding-block: 10px !important;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'block' },
})
export class PathInput implements ControlValueAccessor, AfterContentInit {
  private readonly _http = inject(HttpService);
  private readonly _storage = inject(StorageService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _ngControl = inject(NgControl, { self: true, optional: true });
  /** The menu this field sits in, if any: its panel lives in an overlay of its own and would outlive it. */
  private readonly _menu = inject(MAT_MENU_PANEL, { optional: true });
  private readonly _parentForm = inject(FormGroupDirective, { optional: true }) ?? inject(NgForm, { optional: true });

  readonly label = input<string>();
  readonly placeholder = input('');
  readonly hint = input<string>();
  /** The folder an empty value stands for; see the class comment. Undefined leaves an empty value literal. */
  readonly defaultFolder = input<Nullable<string>>();
  /** Offer files as well as folders, for picking a file's path. */
  readonly files = input(false);
  /** Show the control's (async) validation status as a suffix icon. */
  readonly showStatus = input(false);
  readonly appearance = input<MatFormFieldAppearance>('outline');
  readonly subscriptSizing = input<SubscriptSizing>('fixed');
  readonly inputClass = input('');
  readonly position = input<'auto' | 'above' | 'below'>('auto');
  /** Enter pressed while no option is being picked. */
  readonly enter = output<void>();
  /** Escape pressed while the panel is closed. */
  readonly escape = output<void>();

  protected readonly _control = new FormControl('', { nonNullable: true });
  protected readonly _trigger = viewChild.required(MatAutocompleteTrigger);

  private readonly _text = signal('');
  /** Bumped when the field is focused, so folders made since the last look show up. */
  private readonly _version = signal(0);
  private readonly _status = signal<{ status: string; errors: Nullable<ValidationErrors> }>({
    status: 'VALID',
    errors: null,
  });
  private readonly _cache = new Map<string, Observable<Nullable<FolderListingModel>>>();

  private _onChange: (value: string) => void = () => {};
  protected _onTouched: () => void = () => {};

  private readonly _path = computed(() => splitPath(this._text()));

  private readonly _listing = toSignal(
    toObservable(
      computed(() => ({ dir: this._path().dir, version: this._version() }), {
        equal: (a, b) => a.dir === b.dir && a.version === b.version,
      }),
    ).pipe(
      // Nothing is listed until the field is first focused.
      filter(({ version }) => version > 0),
      debounceTime(150),
      switchMap(({ dir }) => this._load(dir).pipe(map((listing): Listing => ({ dir, listing })))),
    ),
  );

  protected readonly _options = computed<PathOption[]>(() => {
    const current = this._listing();
    const { base, dir, filter } = this._path();

    // Still loading the folder just typed: the old entries would complete into the wrong place.
    if (!current?.listing || current.dir !== dir) return [];

    const needle = filter.toLowerCase();
    const downloads = this._downloadsFolder();

    const options = current.listing.entries
      .filter(({ name }) => name.toLowerCase().includes(needle))
      .map((entry) => {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        const at = downloadsAt(path, entry.type === 'folder' ? downloads : '');

        return {
          ...entry,
          value: `${base}${entry.name}${entry.type === 'folder' ? '/' : ''}`,
          downloads: at,
          tooltip: tooltipFor(at, entry.mount),
        };
      });

    // The usual destination leads, so getting there takes a pick per level
    // rather than a search; the server's order is kept for the rest.
    return [...options.filter((option) => option.downloads), ...options.filter((option) => !option.downloads)];
  });

  /** The downloads folder setting as the listing paths read: "" for the root, which has nothing to lead to. */
  private readonly _downloadsFolder = computed(() => splitPath(`${this._storage.settings().downloadsDir ?? ''}/`).dir);

  /** A note at the end of the panel about what typing on will do. */
  protected readonly _note = computed<Nullable<string>>(() => {
    const current = this._listing();
    const { dir, filter } = this._path();

    if (!current || current.dir !== dir) return null;

    if (!current.listing) return this.files() ? 'Folder not found' : 'New folder — created on download';

    // Only once nothing matches: while a folder is being typed out, the note is noise.
    if (!this.files() && filter.trim() && !this._options().length) return 'New folder — created on download';

    if (current.listing.truncated) return 'Not everything is listed — keep typing to narrow down';

    return null;
  });

  protected readonly _placeholder = computed(() => this.defaultFolder() || this.placeholder());

  protected readonly _defaultNote = computed(() => {
    const folder = this.defaultFolder();

    return folder ? `Leave empty for “${folder}”. Type “/” for the root` : null;
  });

  protected readonly _pending = computed(() => this._status().status === 'PENDING');
  protected readonly _valid = computed(() => this._status().status === 'VALID');

  protected readonly _error = computed(() => {
    const errors = this._status().errors;
    if (!errors) return null;

    return typeof errors['message'] === 'string' ? errors['message'] : 'Invalid path';
  });

  /** Errors come from the outer control, which the inner input knows nothing about. */
  protected readonly _errorMatcher: ErrorStateMatcher = {
    isErrorState: () => {
      const control = this._ngControl?.control;

      return !!control?.invalid && (control.touched || !!this._parentForm?.submitted);
    },
  };

  constructor() {
    if (this._ngControl) this._ngControl.valueAccessor = this;

    // A menu closes on its own (a hover onto a sibling item, a click outside),
    // and the autocomplete does not notice: it would stay open where the menu was.
    this._menu?.close.pipe(takeUntilDestroyed()).subscribe(() => this._trigger().closePanel());

    this._control.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const clean = value.replace(LEADING_DOTS, '$1');

      if (clean !== value) this._control.setValue(clean, { emitEvent: false });

      this._text.set(clean);
      this._onChange(clean);
    });
  }

  writeValue(value: Nullable<string>): void {
    this._control.setValue(value ?? '', { emitEvent: false });
    this._text.set(value ?? '');
  }

  /**
   * `formControlName` hands its control over only after it has registered
   * this accessor, and after this component's own init — by now it has.
   */
  ngAfterContentInit(): void {
    const control = this._ngControl?.control;
    if (!control) return;

    const sync = () => this._status.set({ status: control.status, errors: control.errors });

    sync();
    control.events.pipe(takeUntilDestroyed(this._destroyRef)).subscribe(sync);
  }

  registerOnChange(fn: (value: string) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    if (disabled) this._control.disable({ emitEvent: false });
    else this._control.enable({ emitEvent: false });
  }

  protected _onFocus(): void {
    this._cache.clear();
    this._version.update((version) => version + 1);
  }

  protected _onSelected({ option }: MatAutocompleteSelectedEvent): void {
    // The trigger closes the panel right after this; reopen it on what is inside the folder.
    if ((option.value as string).endsWith('/')) setTimeout(() => this._trigger().openPanel());
  }

  protected _onEnter(event: Event): void {
    const trigger = this._trigger();

    // The trigger picks the highlighted option on Enter; that is not a submit.
    if (event.defaultPrevented || (trigger.panelOpen && trigger.activeOption)) return;

    this.enter.emit();
  }

  protected _onEscape(event: Event): void {
    // The first Escape closes the panel.
    if (event.defaultPrevented || this._trigger().panelOpen) return;

    this.escape.emit();
  }

  private _load(dir: string): Observable<Nullable<FolderListingModel>> {
    const key = `${this.files()}:${dir}`;
    let request = this._cache.get(key);

    if (!request) {
      request = this._http.getFolder(dir, this.files()).pipe(
        catchError(() => of(null)),
        shareReplay(1),
      );
      this._cache.set(key, request);
    }

    return request;
  }
}
