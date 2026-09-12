import { ChannelFormModel } from '@shared/models';

/** Boolean controls surfaced through the "Additional flags" multi-select. */
export type SubscriptionFlagKey = keyof Pick<
  ChannelFormModel,
  'downloadShorts' | 'splitChapters' | 'removeSponsors' | 'notifyHA' | 'pollOnce' | 'startFromLast'
>;

export interface SubscriptionFlag {
  value: SubscriptionFlagKey;
  label: string;
  descriptionActive: string;
  descriptionInactive: string;
  enabled: boolean;
  isEditing: boolean;
  icon: string;
  tooltip?: string;
}
