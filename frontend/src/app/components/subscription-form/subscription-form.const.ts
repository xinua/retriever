import { SubscriptionFlag } from './subscription-form.model';

export const SUBSCRIPTION_FLAG_OPTIONS: SubscriptionFlag[] = [
  {
    value: 'downloadShorts',
    label: 'Shorts',
    descriptionActive: 'Include',
    descriptionInactive: 'Ignore',
    enabled: true,
    isEditing: true,
    icon: 'local_movies',
  },
  {
    value: 'splitChapters',
    label: 'Chapters',
    descriptionActive: 'Split',
    descriptionInactive: 'Leave as is',
    enabled: true,
    isEditing: true,
    icon: 'vertical_split',
  },
  {
    value: 'removeSponsors',
    label: 'Sponsors',
    descriptionActive: 'Remove',
    descriptionInactive: 'Keep',
    enabled: true,
    isEditing: true,
    icon: 'content_cut',
  },
  {
    value: 'notifyHA',
    label: 'Webhook',
    descriptionActive: 'Send',
    descriptionInactive: 'Do not send',
    enabled: true,
    isEditing: true,
    icon: 'webhook',
  },
  {
    value: 'pollOnce',
    label: 'Polling',
    descriptionActive: 'One-time',
    descriptionInactive: 'Ongoing',
    tooltip: 'Stop polling for today after first capture',
    enabled: true,
    isEditing: true,
    icon: 'poll',
  },
  {
    value: 'startFromLast',
    label: 'Start with',
    descriptionActive: 'Last video',
    descriptionInactive: 'Next video',
    tooltip: 'Select this option to download latest video now',
    enabled: true,
    isEditing: false,
    icon: 'download',
  },
];

/** Every selectable poll hour, zero-padded so the values sort lexicographically. */
export const POLL_TIME_OPTIONS: string[] = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, '0')}:00`,
);
