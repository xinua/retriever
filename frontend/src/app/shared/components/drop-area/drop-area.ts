import { Component, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { DRAG_TOKEN } from '../../constants/drag-token';
import { NotifierService } from 'angular-notifier';
import { Observable, take, tap } from 'rxjs';
import { Decision, DecisionDialog } from '../decision-dialog/decision-dialog';

const ALLOWED_FILE_TYPES: string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
// Matches the server's body limit for image uploads.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const DEFAULT_DIALOG_DATA: MatDialogConfig = {
  data: {
    title: 'Update image',
    message: 'Are you sure you want to replace the current image?',
    cancelText: 'No',
    actionText: 'Yes',
  },
};

@Component({
  selector: 'rt-drop-area',
  imports: [MatIcon],
  templateUrl: './drop-area.html',
  styleUrl: './drop-area.css',
  host: {
    '(dragleave)': 'onDragLeave()',
    '(dragenter)': 'onDragEnter()',
    '(drop)': 'onDrop()',
  },
})
export class DropArea {
  private readonly _dialog = inject(MatDialog);
  private readonly _notifier = inject(NotifierService);
  private dragDepth = 0;

  label = input<string>('Drop image here');
  dragOverlabel = input<string>('Drop here');
  customClass = input<string>('');
  dialogData = input<MatDialogConfig>(DEFAULT_DIALOG_DATA);
  onFileDrop = output<{ file: File; decision: Decision }>();
  askForDecision = input<boolean>(true);

  readonly isDragOver = signal<boolean>(false);
  readonly allowedFileTypes = ALLOWED_FILE_TYPES;
  readonly isDragStarted = toSignal(inject(DRAG_TOKEN), { initialValue: false });

  onDragEnter() {
    this.dragDepth++;
    this.isDragOver.set(true);
  }

  onDragLeave() {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.isDragOver.set(false);
    }
  }

  onDrop() {
    this.dragDepth = 0;
    this.isDragOver.set(false);
  }

  uploadFile(files: FileList) {
    const file = files?.[0];
    if (!file) return;

    // `accept` only filters the file picker; a dropped file gets through regardless.
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      this._notifier.notify('error', 'Only JPEG, PNG or WebP images are supported');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      this._notifier.notify('error', 'File size is too big (max 10 MB)');
      return;
    }

    if (!this.askForDecision()) {
      this.onFileDrop.emit({ file, decision: Decision.CONFIRM });
      return;
    }

    this._openConfirmationDialog()
      .pipe(
        take(1),
        tap((decision) => this.onFileDrop.emit({ file, decision })),
      )
      .subscribe();
  }

  private _openConfirmationDialog(): Observable<Decision> {
    const dialogRef = this._dialog.open(DecisionDialog, this.dialogData());
    return dialogRef.afterClosed();
  }
}
