import type { ConsoleAlert } from '../types'

export type AlertStatus = 'live' | 'scheduled' | 'expired' | 'disabled'

/**
 * Mirrors the server's active-alert filter (GetActiveAlerts) so the admin
 * list shows what signed-in users currently see.
 */
export function getAlertStatus(
  alert: Pick<ConsoleAlert, 'enabled' | 'startsAt' | 'endsAt'>,
  now: number
): AlertStatus {
  if (!alert.enabled) return 'disabled'
  if (alert.startsAt && now < new Date(alert.startsAt).getTime()) {
    return 'scheduled'
  }
  if (alert.endsAt && now >= new Date(alert.endsAt).getTime()) {
    return 'expired'
  }
  return 'live'
}
