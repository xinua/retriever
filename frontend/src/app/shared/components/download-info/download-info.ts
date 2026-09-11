import { Component, input } from '@angular/core';
import { DownloadModel } from '../../models/download.model';
import { MatTableModule } from '@angular/material/table';
import { DownloadStatus, SizePipe, TimeFormat, TimePipe } from '../..';
import { DatePipe, TitleCasePipe } from '@angular/common';

@Component({
  selector: 'rt-download-info',
  imports: [MatTableModule, SizePipe, TitleCasePipe, DatePipe, TimePipe],
  templateUrl: './download-info.html',
  styleUrl: './download-info.css',
})
export class DownloadInfo {
  download = input.required<DownloadModel>();
  readonly downloadStatus = DownloadStatus;
  readonly timeFormat = TimeFormat;
}
