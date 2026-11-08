/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

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

/** Level icon, so the level is not conveyed by tint alone (WCAG 1.4.1). */
export const ALERT_LEVEL_ICON: Record<AlertLevel, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
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
