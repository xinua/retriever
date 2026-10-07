import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialogConfig } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { Codecs, PollType, SubscriptionModel, Types, VideoQuality } from '../../models/subscription.model';
import { ManualDownloadRequest } from '../../models/download.model';
import { NotifierService } from 'angular-notifier';
import { HA_AUTOMATION_CODE, WIDGET_CODE } from '../../constants/code.const';
import { AudioFormatLabels, CodecLabels, VideoFormatLabels } from '../../constants/labels.const';
import { DayPipe } from '../../pipes/day.pipe';
import { TimePipe } from '../../pipes/time.pipe';
import { HttpService } from '../../services/http.service';
import { StorageService } from '../../services/storage.service';
import { RtAvatar } from '../avatar/avatar';
import { Decision } from '../decision-dialog/decision-dialog';
import { DropArea } from '../drop-area/drop-area';
import { RtPlayer } from '../player/player';
import { RtSteamCard } from '../steam-card/steam-card';

const DIALOG_AVATAR_DATA: MatDialogConfig = {
  data: {
    title: 'Replace avatar',
    message: 'This action will replace the avatar for all download records related to this channel.',
    cancelText: 'Cancel',
    actionText: 'Update',
  },
};

@Component({
  selector: 'rt-subscription-details',
  imports: [
    RtSteamCard,
    TitleCasePipe,
    TimePipe,
    MatTooltip,
    MatIcon,
    DatePipe,
    DayPipe,
    MatIconButton,
    MatMenuModule,
    RtAvatar,
    RtPlayer,
    DropArea,
  ],
  templateUrl: './subscription-details.html',
  styleUrl: './subscription-details.css',
})
export class SubscriptionDetails {
  private readonly _storage = inject(StorageService);
  private readonly _notifier = inject(NotifierService);
  private readonly _httpService = inject(HttpService);

  sub = input.required<SubscriptionModel>();
  isExpanded = input<boolean>(false);

  readonly types = Types;
  readonly pollType = PollType;
  readonly codec = Codecs;
  readonly codecLabels = CodecLabels;
  readonly videoFormatLabels = VideoFormatLabels;
  readonly audioFormatLabels = AudioFormatLabels;
  readonly dialogData = DIALOG_AVATAR_DATA;

  readonly settings = this._storage.settings;

  copyHaCardCode(id: SubscriptionModel['id']) {
    navigator.clipboard.writeText(WIDGET_CODE(window.location.origin, id));
    this._notifier.notify('success', 'Home Assistant card code copied to clipboard');
  }

  openWidgetInNewTab(id: SubscriptionModel['id']) {
    window.open(`${window.location.origin}/widget/${id}`, '_blank');
  }

  copyHaCardAutomationCode(id: SubscriptionModel['id']) {
    const subWebhookId = this.sub().webhookOverride?.split('/')?.pop();
    const globalWebhookId = this._storage.settings().webhookUrl?.split('/')?.pop();
    const webhookId = subWebhookId || globalWebhookId || '<webhook_id>';

    navigator.clipboard.writeText(HA_AUTOMATION_CODE(webhookId, id));
    this._notifier.notify('success', 'Home Assistant automation code copied to clipboard');
  }

  updateAvatar({ file, decision }) {
    if (!decision || decision === Decision.ALTERNATIVE) return;
    this._httpService.updateSubAvatar(this.sub().id, file).subscribe();
  }

  downloadAgain() {
    this._httpService.createDownload(this._toRequest()).subscribe({
      next: () => {
        this._notifier.notify('success', 'Download started');
      },
      error: (error) => {
        this._notifier.notify('error', 'Failed to queue download');
        console.error(error);
      },
    });
  }

  private _toRequest(): ManualDownloadRequest {
    const value = this.sub();
    const trim = (input: string): string | null => input?.trim() || null;

    return {
      url: 'https://www.youtube.com/watch?v=' + value.lastVideoId,
      type: value.type,
      format: value.format,
      codec: value.codec,
      quality: VideoQuality.BEST,
      folder: trim(value.tag),
      prefix: value.prefix?.length ? value.prefix : null,
      ytdlpArgs: trim(value.ytdlpArgs),
      clipStart: null,
      clipEnd: null,
      removeSponsor: value.removeSponsors,
      splitChapters: value.splitChapters,
      watcherId: value.id,
    };
  }
}
