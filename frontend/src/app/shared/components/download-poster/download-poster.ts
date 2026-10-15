import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialogConfig } from '@angular/material/dialog';
import { NoEmbedFormats } from '../../models/subscription.model';
import { NotifierService } from 'angular-notifier';
import { finalize, fromEvent, take, takeWhile } from 'rxjs';
import { hasFile } from '../../helpers/common.helpers';
import { DownloadModel, DownloadStatus } from '../../models/download.model';
import { HttpService } from '../../services/http.service';
import { AudioPlayer } from '../audio-player/audio-player';
import { Decision } from '../decision-dialog/decision-dialog';
import { DropArea } from '../drop-area/drop-area';
import { RtSteamCard } from '../steam-card/steam-card';
import { NgTemplateOutlet } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LongPress } from '../../directives/long-press';
import { ClickAction, DoubleClick } from '../../directives/click';
import { MatIcon } from '@angular/material/icon';

const UNSUPPORTED_FORMATS = [NoEmbedFormats.WEBM, NoEmbedFormats.MOV, NoEmbedFormats.OPUS, NoEmbedFormats.WAV];
const SEEK_STEP = 10;

@Component({
  selector: 'rt-download-poster',
  imports: [RtSteamCard, AudioPlayer, DropArea, NgTemplateOutlet, MatTooltipModule, DoubleClick, LongPress, MatIcon],
  templateUrl: './download-poster.html',
  styleUrl: './download-poster.css',
})
export class DownloadPoster {
  private readonly _httpService = inject(HttpService);
  private readonly _notifier = inject(NotifierService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);

  download = input.required<DownloadModel>();

  readonly downloadStatus = DownloadStatus;
  readonly clickAction = ClickAction;
  isUpdatingPoster = signal(false);
  activeMedia = signal<number | null>(null);
  seekDirection = signal<string | null>(null);
  seekTotalTime = signal<number>(0);
  seekTimeout = signal<ReturnType<typeof setTimeout>>(null);
  hasFile = computed(() => hasFile(this.download()));
  mediaUrl = computed(() => this._httpService.streamFileUrl(this.download()?.id));
  unsupportedFormat = computed(() =>
    UNSUPPORTED_FORMATS.includes((this.download()?.mediaFormat as NoEmbedFormats) || null),
  );
  dialogData = computed(() => this._dialogData());

  videoPlayer = viewChild<ElementRef<HTMLVideoElement>>('previewVideo');
  audioPlayer = viewChild<AudioPlayer>(AudioPlayer);

  constructor() {
    this._destroyRef.onDestroy(() => {
      if (this.seekTimeout()) clearTimeout(this.seekTimeout());
    });
  }

  togglePlay(target: DownloadModel, isAbleToOpen: boolean, event?: MouseEvent | Event, action?: ClickAction) {
    if (!isAbleToOpen) return;
    if (this.seekDirection() && action === ClickAction.SINGLE && this.download()?.type === 'audio') return;
    if (action === ClickAction.SINGLE && this.activeMedia() === target.id) {
      this.audioPlayer()?.togglePlayPause();
      return;
    }

    if (action === ClickAction.DOUBLE && this.activeMedia() == target.id && this.download()?.type === 'audio') {
      this._seek(event as MouseEvent);
      return;
    }

    this.activeMedia.update((current) => (current === target.id ? null : target.id));
    if (this.activeMedia() === null) event?.preventDefault();
    if (this.activeMedia() !== null) this._trackVideoFinished();
  }

  handleError() {
    this.activeMedia.set(null);
    this._notifier.notify('error', 'File is no longer on disk');
  }

  updatePoster(event: { file: File; decision: Decision }) {
    if (!event.decision) return;
    if ((this.unsupportedFormat() || !this.download()?.fileExists) && event.decision === Decision.ALTERNATIVE) return;

    const embed = this.download()?.fileExists
      ? this.unsupportedFormat()
        ? false
        : event.decision === Decision.CONFIRM
      : false;

    if (embed) this.isUpdatingPoster.set(true);

    this._httpService
      .updateDownloadPoster(this.download().id, event.file, embed)
      .pipe(finalize(() => this.isUpdatingPoster.set(false)))
      .subscribe({
        next: (response) => {
          if (response.coverEmbedded) this._notifier.notify('success', 'Poster and thumbnail updated');
          else if (!embed) this._notifier.notify('success', 'Poster updated');
          else this._notifier.notify('error', 'Failed to update thumbnail');
        },
      });
  }

  private _seek($event: MouseEvent) {
    const direction = this._getDirection($event);

    this.showSeekDirection(direction);
    this.audioPlayer()?.seekBy(direction === 'left' ? -SEEK_STEP : SEEK_STEP);
  }

  private _getDirection(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = rect.width;
    const relX = x / width;
    return relX < 0.5 ? 'left' : 'right';
  }

  private showSeekDirection(direction: string) {
    if (!this.seekDirection() || this.seekDirection() === direction) {
      this.seekTotalTime.update((total) => total + SEEK_STEP);
    } else {
      this.seekTotalTime.set(SEEK_STEP);
    }

    this.seekDirection.set(direction);

    if (this.seekTimeout()) {
      clearTimeout(this.seekTimeout());
    }

    this.seekTimeout.set(
      setTimeout(() => {
        this.seekDirection.set(null);
        this.seekTotalTime.set(0);
      }, 1000),
    );
  }

  private _dialogData(): MatDialogConfig {
    const unsupportedMessage = "The file format doesn't support embedding images, so only the poster will be updated.";
    const unexistingFileMessage = 'The file no longer exists, so only the poster will be updated.';
    const supportedMessage = `Would you like to update the file's thumbnail along with the poster?`;

    const message = !this.download()?.fileExists
      ? unexistingFileMessage
      : this.unsupportedFormat()
        ? unsupportedMessage
        : supportedMessage;

    return {
      data: {
        title: 'Replace poster',
        message,
        cancelText: !this.download()?.fileExists || this.unsupportedFormat() ? 'Cancel' : 'No, only the poster',
        actionText: !this.download()?.fileExists || this.unsupportedFormat() ? 'Update' : 'Yes, update both',
      },
    };
  }

  private _trackVideoFinished() {
    this._cdr.detectChanges();
    const player = this.videoPlayer()?.nativeElement || this.audioPlayer()?.nativePlayer()?.nativeElement;

    if (!player) return;

    fromEvent(player, 'ended')
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        takeWhile(() => this.activeMedia() !== null),
        take(1),
      )
      .subscribe(() => this.activeMedia.set(null));
  }
}
