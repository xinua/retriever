import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { Codecs, PollType, SubscriptionModel, Types } from '@shared/models';
import { AudioFormatLabels, CodecLabels, VideoFormatLabels } from '../../constants/labels.const';
import { DayPipe } from '../../pipes/day.pipe';
import { TimeFormat, TimePipe } from '../../pipes/time.pipe';
import { StorageService } from '../../services/storage.service';
import { RtSteamCard } from '../steam-card/steam-card';
import { HA_AUTOMATION_CODE, WIDGET_CODE } from '../../../components/widget-page/widget.constants';
import { NotifierService } from 'angular-notifier';
import { RtAvatar } from '../avatar/avatar';
import { RtPlayer } from '../player/player';

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
  ],
  templateUrl: './subscription-details.html',
  styleUrl: './subscription-details.css',
})
export class SubscriptionDetails {
  private readonly _storage = inject(StorageService);
  private readonly _notifier = inject(NotifierService);

  sub = input.required<SubscriptionModel>();
  isExpanded = input<boolean>(false);

  readonly types = Types;
  readonly pollType = PollType;
  readonly codec = Codecs;
  readonly codecLabels = CodecLabels;
  readonly videoFormatLabels = VideoFormatLabels;
  readonly audioFormatLabels = AudioFormatLabels;
  readonly TimeFormat = TimeFormat;

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
}
