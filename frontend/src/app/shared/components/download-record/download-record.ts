import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, computed, ElementRef, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogConfig } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { DownloadStatusLabels } from '../../constants/labels.const';
import { AppearDirective } from '../../directives/appear.directive';
import { DownloadModel, DownloadSource, DownloadStatus } from '../../models/download.model';
import { PaginatorModel } from '../../models/common.model';
import { SizePipe } from '../../pipes/size.pipe';
import { HttpService } from '../../services/http.service';
import { RtAvatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Decision } from '../decision-dialog/decision-dialog';
import { DownloadControls } from '../download-controls/download-controls';
import { DownloadInfo } from '../download-info/download-info';
import { DownloadPoster } from '../download-poster/download-poster';
import { DropArea } from '../drop-area/drop-area';
import { ProgressInfo } from '../progress-info/progress-info';
import { StatusIndicator } from '../status-indicator/status-indicator';

const DEFAULT_AVATARS = 'default.webp';
const DIALOG_DATA: MatDialogConfig = {
  data: {
    title: 'Replace avatar',
    message: 'Are you sure you want to replace this image? This will affect all download records that use it.',
    cancelText: 'Cancel',
    actionText: 'Update',
  },
};

@Component({
  selector: 'rt-download-record',
  imports: [
    AppearDirective,
    MatIcon,
    MatButtonModule,
    SizePipe,
    MatTableModule,
    TitleCasePipe,
    DatePipe,
    Badge,
    StatusIndicator,
    ProgressInfo,
    DownloadInfo,
    DownloadControls,
    MatTooltip,
    RtAvatar,
    DownloadPoster,
    DropArea,
  ],
  templateUrl: './download-record.html',
  styleUrl: './download-record.css',
})
export class DownloadRecord {
  private readonly _httpService = inject(HttpService);

  index = input.required<number>();
  download = input.required<DownloadModel>();
  paginator = input.required<PaginatorModel>();

  cancel = output<DownloadModel>();
  retry = output<DownloadModel>();
  remove = output<{ download: DownloadModel; elementRef: HTMLElement }>();
  saveAs = output<DownloadModel>();
  copyFilePath = output<DownloadModel>();
  setFilePath = output<{ filePath: string; download: DownloadModel }>();

  readonly dialogData = DIALOG_DATA;
  readonly downloadStatus = DownloadStatus;
  readonly downloadSource = DownloadSource;
  readonly statusLabels = DownloadStatusLabels;
  defaultImage = computed<boolean>(() => this.download().avatarPath?.includes(DEFAULT_AVATARS));

  private hostElement = inject(ElementRef).nativeElement;

  // Remove class to allow hover effect to work
  ngAfterViewInit() {
    const animationName = 'reveal';
    const animationDuration = 2500;

    setTimeout(() => {
      this.hostElement.classList.remove(animationName);
    }, animationDuration);
  }

  updateAvatar(event: { file: File; decision: Decision }) {
    if (event.decision === Decision.ALTERNATIVE || !event.decision) return;
    this._httpService.updateDownloadAvatar(this.download().id, event.file).subscribe();
  }
}
