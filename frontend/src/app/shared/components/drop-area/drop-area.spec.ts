import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { DRAG_TOKEN } from '@shared/constants';
import { NotifierService } from 'angular-notifier';
import { BehaviorSubject, of } from 'rxjs';
import { provideNotifier } from '../../providers';
import { Decision } from '../decision-dialog/decision-dialog';

import { DropArea } from './drop-area';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';

describe('DropArea', () => {
  let component: DropArea;
  let fixture: ComponentFixture<DropArea>;
  let drag$: BehaviorSubject<boolean>;
  let open: ReturnType<typeof vi.fn>;
  let dropped: { file: File; decision: Decision }[];

  beforeEach(async () => {
    drag$ = new BehaviorSubject(false);
    open = vi.fn(() => ({ afterClosed: () => of(Decision.CONFIRM) }));

    await TestBed.configureTestingModule({
      imports: [DropArea],
      providers: [
        provideNotifier(),
        { provide: DRAG_TOKEN, useValue: drag$ },
        { provide: MatDialog, useValue: { open } },
      ],
    }).compileComponents();

    const sanitizer = TestBed.inject(DomSanitizer);
    ['retriever', 'upload_image'].forEach((name) =>
      TestBed.inject(MatIconRegistry).addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml('<svg></svg>')),
    );

    fixture = TestBed.createComponent(DropArea);
    component = fixture.componentInstance;
    dropped = [];
    component.onFileDrop.subscribe((event) => dropped.push(event));
    await fixture.whenStable();
  });

  const image = (type = 'image/png', size = 1024) => new File([new Uint8Array(size)], 'cover', { type });
  const fileList = (...files: File[]) => files as unknown as FileList;

  it('stays hidden until files are dragged over the page', async () => {
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();

    drag$.next(true);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('input[type=file]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Drop image here');
  });

  it('asks for a decision before passing the file up', () => {
    const file = image();
    component.uploadFile(fileList(file));

    expect(open).toHaveBeenCalled();
    expect(dropped).toEqual([{ file, decision: Decision.CONFIRM }]);
  });

  it('passes the file straight up when no decision is wanted', async () => {
    fixture.componentRef.setInput('askForDecision', false);
    await fixture.whenStable();

    const file = image();
    component.uploadFile(fileList(file));

    expect(open).not.toHaveBeenCalled();
    expect(dropped).toEqual([{ file, decision: Decision.CONFIRM }]);
  });

  it('rejects a file that is not a supported image', () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    component.uploadFile(fileList(image('application/pdf')));

    expect(notify).toHaveBeenCalledWith('error', expect.any(String));
    expect(open).not.toHaveBeenCalled();
    expect(dropped).toEqual([]);
  });

  it('rejects an image over 10 MB', () => {
    const notify = vi.spyOn(TestBed.inject(NotifierService), 'notify');
    component.uploadFile(fileList(image('image/jpeg', 10 * 1024 * 1024 + 1)));

    expect(notify).toHaveBeenCalledWith('error', expect.any(String));
    expect(dropped).toEqual([]);
  });

  it('ignores an empty drop', () => {
    component.uploadFile(fileList());

    expect(open).not.toHaveBeenCalled();
    expect(dropped).toEqual([]);
  });
});
