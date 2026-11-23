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
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { MAIN_CONTENT_ID } from '@/components/layout/constants'
import { Button } from '@/components/ui/button'
import {
  ALERT_DISMISSALS_STORAGE_KEY,
  useAlertDismissalStore,
} from '@/stores/alert-dismissal-store'

import { activeAlertsQueryOptions } from '../api'
import { getAlertDismissKey } from '../lib/dismiss-key'
import type { ConsoleAlert } from '../types'
import { ConsoleAlertCard } from './console-alert-card'

/** One toast id, so closing several alerts in a row shows one hint. */
const DISMISS_HINT_TOAST_ID = 'console-alert-dismiss-hint'

/**
 * Live site alerts pinned above every signed-in console page. Failed fetches
 * render nothing and never toast. Closed alerts stay readable in the header
 * bell, and closing one says so.
 */
export function ConsoleAlerts() {
  const { t } = useTranslation()
  const dismissedKeys = useAlertDismissalStore((s) => s.dismissedKeys)
  const dismiss = useAlertDismissalStore((s) => s.dismiss)
  const prune = useAlertDismissalStore((s) => s.prune)

  const sectionRef = useRef<HTMLElement>(null)
  // Position of the dismiss button just used; focus moves to the button now
  // in that position so keyboard users keep their place.
  const pendingFocusIndex = useRef<number | null>(null)

  const alertsQuery = useQuery(activeAlertsQueryOptions)
  const alerts = alertsQuery.data

  useEffect(() => {
    if (alerts) prune(alerts.map((alert) => getAlertDismissKey(alert)))
  }, [alerts, prune])

  // Another console tab dismissed or pruned alerts: reload the list so this
  // tab hides them too and does not overwrite them on its next write.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ALERT_DISMISSALS_STORAGE_KEY || event.key === null) {
        void useAlertDismissalStore.persist.rehydrate()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const visibleAlerts = useMemo(
    () =>
      (alerts ?? []).filter(
        (alert) =>
          !alert.dismissible ||
          !dismissedKeys.includes(getAlertDismissKey(alert))
      ),
    [alerts, dismissedKeys]
  )

  useLayoutEffect(() => {
    const index = pendingFocusIndex.current
    if (index === null) return
    pendingFocusIndex.current = null
    const buttons = sectionRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-alert-dismiss]'
    )
    const next = buttons?.[Math.min(index, buttons.length - 1)]
    if (next) {
      next.focus()
      return
    }
    document.querySelector<HTMLElement>(`#${MAIN_CONTENT_ID}`)?.focus()
  }, [visibleAlerts])

  const handleDismiss = (alert: ConsoleAlert, button: HTMLButtonElement) => {
    const buttons = [
      ...(sectionRef.current?.querySelectorAll('[data-alert-dismiss]') ?? []),
    ]
    pendingFocusIndex.current = buttons.indexOf(button)
    dismiss(getAlertDismissKey(alert))
    toast.info(t('Closed. Open the bell at the top right to read it again'), {
      id: DISMISS_HINT_TOAST_ID,
    })
  }

  if (visibleAlerts.length === 0) return null

  return (
    <section
      ref={sectionRef}
      aria-label={t('Site alerts')}
      className='flex max-h-[40svh] shrink-0 flex-col gap-2 overflow-y-auto px-3 pt-3 sm:px-4'
    >
      {visibleAlerts.map((alert) => {
        const idPrefix = `console-alert-${alert.id}`
        return (
          <ConsoleAlertCard
            key={alert.id}
            alert={alert}
            idPrefix={idPrefix}
            role={alert.level === 'error' ? 'alert' : 'status'}
            action={
              alert.dismissible ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  data-alert-dismiss=''
                  aria-label={t('Dismiss alert')}
                  aria-describedby={`${idPrefix}-${alert.title ? 'title' : 'content'}`}
                  onClick={(event) => handleDismiss(alert, event.currentTarget)}
                >
                  <X aria-hidden='true' />
                </Button>
              ) : null
            }
          />
        )
      })}
    </section>
  )
}
