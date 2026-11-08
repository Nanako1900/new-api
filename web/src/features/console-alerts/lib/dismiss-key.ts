import { hashString } from '@/lib/hash'

import type { ConsoleAlert } from '../types'

/**
 * Identifies one version of an alert in the dismissal store. Editing the
 * title, content or level yields a new key, so users see the alert again;
 * schedule, enabled and dismissible changes keep the key.
 */
export function getAlertDismissKey(
  alert: Pick<ConsoleAlert, 'id' | 'title' | 'content' | 'level'>
): string {
  const fingerprint = JSON.stringify([
    alert.title ?? '',
    alert.content,
    alert.level,
  ])
  return `${alert.id}:${hashString(fingerprint)}`
}
