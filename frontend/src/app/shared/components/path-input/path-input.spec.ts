import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { Observable, of, Subject, throwError } from 'rxjs';
import { FolderListingModel } from '../../models/settings.model';
import { HttpService } from '../../services/http.service';
import { StorageService } from '../../services/storage.service';

import { PathInput, splitPath } from './path-input';

@Component({
  imports: [PathInput, ReactiveFormsModule],
  // formControlName, as the forms use it: it hands over its control later than [formControl] does.
  template: `
    <form [formGroup]="form">
      <rt-path-input
        label="Folder"
        placeholder="e.g. podcasts"
        formControlName="folder"
        [files]="files()"
        [showStatus]="true"
        [defaultFolder]="defaultFolder()"
        (enter)="enters = enters + 1"
      />
    </form>
  `,
})
class HostComponent {
  control = new FormControl<string | null>('');
  form = new FormGroup({ folder: this.control });
  files = signal(false);
  defaultFolder = signal<string | undefined>(undefined);
  enters = 0;
}

const listing = (path: string, entries: FolderListingModel['entries'], truncated = false): FolderListingModel => ({
  path,
  entries,
  truncated,
});

const ROOT = listing('', [
  { name: 'anime', type: 'folder', mount: false },
  { name: 'movies', type: 'folder', mount: true },
  { name: 'notes.txt', type: 'file', mount: false },
]);

const ANIME = listing('anime', [
  { name: 'Naruto', type: 'folder', mount: false },
  { name: 'One Piece', type: 'folder', mount: false },
]);

describe('splitPath', () => {
  it('lists the folder before the last slash and filters by the rest', () => {
    expect(splitPath('')).toEqual({ base: '', dir: '', filter: '' });
    expect(splitPath('an')).toEqual({ base: '', dir: '', filter: 'an' });
    expect(splitPath('anime/')).toEqual({ base: 'anime/', dir: 'anime', filter: '' });
    expect(splitPath('anime/Na')).toEqual({ base: 'anime/', dir: 'anime', filter: 'Na' });
  });

  it('takes a leading slash and doubled slashes as nothing', () => {
    expect(splitPath('/')).toEqual({ base: '/', dir: '', filter: '' });
    expect(splitPath('//anime//Na')).toEqual({ base: '//anime//', dir: 'anime', filter: 'Na' });
  });
});

describe('PathInput', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let getFolder: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();

    getFolder = vi.fn((path: string) => {
      if (path === '') return of(ROOT);
      if (path === 'anime') return of(ANIME);

      return throwError(() => ({ status: 404 }));
    });

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: HttpService, useValue: { getFolder } }],
    }).compileComponents();

    // The pending status uses a registered SVG icon; a blank one resolves it.
    TestBed.inject(MatIconRegistry).addSvgIconLiteral(
      'loading',
      TestBed.inject(DomSanitizer).bypassSecurityTrustHtml('<svg></svg>'),
    );

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await settle();
  });

  afterEach(() => vi.useRealTimers());

  const el = (): HTMLElement => fixture.nativeElement;
  const input = (): HTMLInputElement => el().querySelector('input')!;
  const options = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
  const optionTexts = (): string[] => options().map((option) => option.textContent!.trim());
  const optionIcons = (): (string | null)[] =>
    options().map((option) => option.querySelector('mat-icon')!.getAttribute('fonticon'));

  async function settle() {
    await vi.advanceTimersByTimeAsync(200);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function focus() {
    input().dispatchEvent(new Event('focusin'));
    input().dispatchEvent(new Event('focus'));
    await settle();
  }

  async function type(text: string) {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    await settle();
  }

  it('lists nothing until the field is focused', () => {
    expect(getFolder).not.toHaveBeenCalled();
  });

  it('offers what is in the root, a separate filesystem marked', async () => {
    await focus();

    expect(getFolder).toHaveBeenCalledWith('', false);
    expect(optionTexts()).toEqual(['anime', 'movies', 'notes.txt']);
    expect(optionIcons()).toEqual(['folder', 'folder_special', 'description']);
    expect(options()[1].classList).toContain('text-amber-400!');
  });

  describe('with a downloads folder set', () => {
    const downloadsDir = (value: string) =>
      TestBed.inject(StorageService).settings.update((settings) => ({ ...settings, downloadsDir: value }));

    it('puts it first, marked', async () => {
      downloadsDir('/movies/');
      await focus();

      expect(optionTexts()).toEqual(['movies', 'anime', 'notes.txt']);
      // A separate filesystem keeps its own mark.
      expect(optionIcons()).toEqual(['folder_special', 'folder', 'description']);
    });

    it('puts the folder that leads to it first, at every level', async () => {
      downloadsDir('anime/One Piece');
      await focus();

      expect(optionTexts()).toEqual(['anime', 'movies', 'notes.txt']);
      expect(optionIcons()).toEqual(['folder_open', 'folder_special', 'description']);

      await type('anime/');

      expect(optionTexts()).toEqual(['One Piece', 'Naruto']);
      expect(optionIcons()).toEqual(['folder_open', 'folder']);
    });

    it('does not match a folder that only starts with the same name', async () => {
      downloadsDir('anime-old');
      await focus();

      expect(optionTexts()).toEqual(['anime', 'movies', 'notes.txt']);
    });

    it('keeps the order when it is the root', async () => {
      downloadsDir('/');
      await focus();

      expect(optionTexts()).toEqual(['anime', 'movies', 'notes.txt']);
      expect(optionIcons()).toEqual(['folder', 'folder_special', 'description']);
    });
  });

  it('asks for files when they are wanted', async () => {
    host.files.set(true);
    await settle();
    await focus();

    expect(getFolder).toHaveBeenCalledWith('', true);
  });

  it('lists the typed folder and filters by the rest', async () => {
    await focus();
    await type('anime/na');

    expect(getFolder).toHaveBeenLastCalledWith('anime', false);
    expect(optionTexts()).toEqual(['Naruto']);
  });

  it('fills in a picked folder with a trailing slash', async () => {
    await focus();
    await type('anime/Na');

    options()[0].click();
    await settle();

    expect(host.control.value).toBe('anime/Naruto/');
  });

  it('does not ask again while typing within the same folder', async () => {
    await focus();
    await type('anime/N');
    await type('anime/Na');
    await type('anime/Nar');

    expect(getFolder.mock.calls.filter(([path]) => path === 'anime')).toHaveLength(1);
  });

  it('notes that a folder that does not exist will be created', async () => {
    await focus();
    await type('newdir/');

    expect(optionTexts()).toEqual(['New folder — created on download']);
  });

  it('notes a new folder once nothing in the listing matches', async () => {
    await focus();
    await type('anime/Bleach');

    expect(optionTexts()).toEqual(['New folder — created on download']);
  });

  it('says a missing folder is not found when picking a file', async () => {
    host.files.set(true);
    await settle();
    await focus();
    await type('newdir/');

    expect(optionTexts()).toEqual(['Folder not found']);
  });

  it('refuses a dot opening a name, but not one inside it', async () => {
    await type('.hidden/../anime/S01.E02');

    expect(host.control.value).toBe('hidden//anime/S01.E02');
    expect(input().value).toBe('hidden//anime/S01.E02');
  });

  it('shows the value written by the form', async () => {
    host.control.setValue('movies/Matrix');
    await settle();

    expect(input().value).toBe('movies/Matrix');
  });

  it('follows the form control being disabled', async () => {
    host.control.disable();
    await settle();

    expect(input().disabled).toBe(true);
  });

  it('shows the error message of a validator once touched', async () => {
    host.control.setValidators(() => ({ message: 'Downloads folder not writable: /x' }));
    host.control.updateValueAndValidity();
    host.control.markAsTouched();
    await settle();

    expect(el().querySelector('mat-error')?.textContent).toContain('Downloads folder not writable: /x');
  });

  it('shows the status of an async validator as it runs', async () => {
    const result = new Subject<{ message: string } | null>();
    host.control.setAsyncValidators(() => result as Observable<{ message: string } | null>);
    host.control.updateValueAndValidity();
    await settle();

    const suffix = () => el().querySelector('[matSuffix] mat-icon');
    const icon = () => suffix()?.getAttribute('fonticon') ?? suffix()?.getAttribute('svgicon');
    expect(icon()).toBe('loading');

    host.control.markAsTouched();
    result.next({ message: 'yt-dlp not ready' });
    result.complete();
    await settle();

    expect(icon()).toBe('close');
    expect(el().querySelector('mat-error')?.textContent).toContain('yt-dlp not ready');
  });

  it('falls back to a generic error without a message', async () => {
    host.control.setValidators(Validators.required);
    host.control.updateValueAndValidity();
    host.control.markAsTouched();
    await settle();

    expect(el().querySelector('mat-error')?.textContent).toContain('Invalid path');
  });

  describe('with a default folder', () => {
    it('shows it as the placeholder and explains empty and "/"', async () => {
      host.defaultFolder.set('downloads/yt');
      await settle();

      expect(input().placeholder).toBe('downloads/yt');
      expect(el().querySelector('mat-hint')?.textContent).toContain(
        'Leave empty for “downloads/yt”. Type “/” for the root',
      );
    });

    it('says nothing extra when the default is the root', async () => {
      host.defaultFolder.set('');
      await settle();

      expect(input().placeholder).toBe('e.g. podcasts');
      expect(el().querySelector('mat-hint')).toBeNull();
    });
  });

  it('emits enter when no option is highlighted', async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(host.enters).toBe(1);
  });
});
