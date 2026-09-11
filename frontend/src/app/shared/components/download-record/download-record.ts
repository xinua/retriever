import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, ElementRef, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { DownloadStatusLabels } from '../../constants';
import { AppearDirective } from '../../directives';
import { DownloadModel, DownloadSource, DownloadStatus, PaginatorModel } from '../../models';
import { SizePipe } from '../../pipes';
import { RtAvatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { DownloadControls } from '../download-controls/download-controls';
import { DownloadInfo } from '../download-info/download-info';
import { DownloadPoster } from '../download-poster/download-poster';
import { ProgressInfo } from '../progress-info/progress-info';
import { StatusIndicator } from '../status-indicator/status-indicator';

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
  ],
  templateUrl: './download-record.html',
  styleUrl: './download-record.css',
})
export class DownloadRecord {
  index = input.required<number>();
  download = input.required<DownloadModel>();
  paginator = input.required<PaginatorModel>();

  cancel = output<DownloadModel>();
  retry = output<DownloadModel>();
  remove = output<{ download: DownloadModel; elementRef: HTMLElement }>();
  saveAs = output<DownloadModel>();
  copyFilePath = output<DownloadModel>();
  setFilePath = output<{ filePath: string; download: DownloadModel }>();

  readonly downloadStatus = DownloadStatus;
  readonly downloadSource = DownloadSource;
  readonly statusLabels = DownloadStatusLabels;

  private hostElement = inject(ElementRef).nativeElement;

  // Remove class to allow hover effect to work
  ngAfterViewInit() {
    const animationName = 'reveal';
    const animationDuration = 2500;

    setTimeout(() => {
      this.hostElement.classList.remove(animationName);
    }, animationDuration);
  }
}
