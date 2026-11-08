import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { MAIN_CONTENT_ID } from '@/components/layout/constants'
import { RichContent } from '@/components/rich-content'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { requireServerSuccess } from '@/lib/server-error-message'
import {
  ALERT_DISMISSALS_STORAGE_KEY,
  useAlertDismissalStore,
} from '@/stores/alert-dismissal-store'

import { getActiveAlerts } from '../api'
import {
  ALERT_LEVEL_CLASS,
  ALERT_LEVEL_ICON,
  ALERT_LEVEL_META,
  CONSOLE_ALERTS_QUERY_KEY,
} from '../constants'
import { getAlertDismissKey } from '../lib/dismiss-key'
import type { ConsoleAlert } from '../types'

const ALERTS_STALE_TIME_MS = 60 * 1000
const ALERTS_REFETCH_INTERVAL_MS = 5 * 60 * 1000

/**
 * Live site alerts pinned above every signed-in console page. Failed fetches
 * render nothing and never toast; a final HTTP 500 still goes through the
 * app's shared 500 handling, like every console query.
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

  const alertsQuery = useQuery({
    queryKey: CONSOLE_ALERTS_QUERY_KEY,
    queryFn: async () =>
      requireServerSuccess(await getActiveAlerts()).data ?? [],
    staleTime: ALERTS_STALE_TIME_MS,
    refetchInterval: ALERTS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    meta: { errorToast: false },
  })
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
  }

  if (visibleAlerts.length === 0) return null

  return (
    <section
      ref={sectionRef}
      aria-label={t('Site alerts')}
      className='flex max-h-[40svh] shrink-0 flex-col gap-2 overflow-y-auto px-3 pt-3 sm:px-4'
    >
      {visibleAlerts.map((alert) => {
        const LevelIcon = ALERT_LEVEL_ICON[alert.level]
        const titleId = `console-alert-${alert.id}-title`
        const contentId = `console-alert-${alert.id}-content`
        return (
          <Alert
            key={alert.id}
            role={alert.level === 'error' ? 'alert' : 'status'}
            className={ALERT_LEVEL_CLASS[alert.level]}
          >
            <LevelIcon aria-hidden='true' />
            <span className='sr-only'>
              {t(ALERT_LEVEL_META[alert.level].labelKey)}
            </span>
            {alert.title ? (
              <AlertTitle id={titleId} className='[overflow-wrap:anywhere]'>
                {alert.title}
              </AlertTitle>
            ) : null}
            <AlertDescription id={contentId}>
              <RichContent
                breaks
                content={alert.content}
                className='[&_a]:text-foreground'
              />
            </AlertDescription>
            {alert.dismissible ? (
              <AlertAction>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  data-alert-dismiss=''
                  aria-label={t('Dismiss alert')}
                  aria-describedby={alert.title ? titleId : contentId}
                  onClick={(event) => handleDismiss(alert, event.currentTarget)}
                >
                  <X aria-hidden='true' />
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        )
      })}
    </section>
  )
}
