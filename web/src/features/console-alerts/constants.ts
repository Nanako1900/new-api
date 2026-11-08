import type { StatusVariant } from '@/components/status-badge'

import type { AlertStatus } from './lib/alert-status'

export const ALERT_LEVELS = ['info', 'success', 'warning', 'error'] as const
export type AlertLevel = (typeof ALERT_LEVELS)[number]

export const MAX_ALERTS = 20
export const ALERT_TITLE_MAX_LENGTH = 100
export const ALERT_CONTENT_MAX_LENGTH = 500

export const CONSOLE_ALERTS_QUERY_KEY = ['console-alerts'] as const

/** Banner tint per level, built on the theme's semantic color tokens. */
export const ALERT_LEVEL_CLASS: Record<AlertLevel, string> = {
  info: 'border-info/30 bg-info/10',
  success: 'border-success/30 bg-success/10',
  warning: 'border-warning/30 bg-warning/10',
  error: 'border-destructive/30 bg-destructive/10',
}

/** Level label i18n keys and badge variants for the admin list and form. */
export const ALERT_LEVEL_META: Record<
  AlertLevel,
  { labelKey: string; badgeVariant: StatusVariant }
> = {
  info: { labelKey: 'Info', badgeVariant: 'info' },
  success: { labelKey: 'Success', badgeVariant: 'success' },
  warning: { labelKey: 'Warning', badgeVariant: 'warning' },
  error: { labelKey: 'Error', badgeVariant: 'danger' },
}

/** Status label i18n keys and badge variants for the admin list. */
export const ALERT_STATUS_META: Record<
  AlertStatus,
  { labelKey: string; badgeVariant: StatusVariant }
> = {
  live: { labelKey: 'Live', badgeVariant: 'success' },
  scheduled: { labelKey: 'Scheduled', badgeVariant: 'info' },
  expired: { labelKey: 'Expired', badgeVariant: 'neutral' },
  disabled: { labelKey: 'Disabled', badgeVariant: 'neutral' },
}
