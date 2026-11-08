import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
import { ALERT_LEVEL_CLASS, CONSOLE_ALERTS_QUERY_KEY } from '../constants'
import { getAlertDismissKey } from '../lib/dismiss-key'

const ALERTS_STALE_TIME_MS = 60 * 1000
const ALERTS_REFETCH_INTERVAL_MS = 5 * 60 * 1000

/**
 * Live site alerts pinned above every signed-in console page. Fetch failures
 * render nothing: a banner outage must not toast on every page.
 */
export function ConsoleAlerts() {
  const { t } = useTranslation()
  const dismissedKeys = useAlertDismissalStore((s) => s.dismissedKeys)
  const dismiss = useAlertDismissalStore((s) => s.dismiss)
  const prune = useAlertDismissalStore((s) => s.prune)

  const { data: alerts } = useQuery({
    queryKey: CONSOLE_ALERTS_QUERY_KEY,
    queryFn: async () =>
      requireServerSuccess(await getActiveAlerts()).data ?? [],
    staleTime: ALERTS_STALE_TIME_MS,
    refetchInterval: ALERTS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    meta: { errorToast: false },
  })

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

  if (visibleAlerts.length === 0) return null

  return (
    <section
      aria-label={t('Site alerts')}
      className='flex max-h-[40vh] shrink-0 flex-col gap-2 overflow-y-auto px-3 pt-3 sm:px-4'
    >
      {visibleAlerts.map((alert) => (
        <Alert
          key={alert.id}
          role={alert.level === 'error' ? 'alert' : 'status'}
          className={ALERT_LEVEL_CLASS[alert.level]}
        >
          {alert.title ? <AlertTitle>{alert.title}</AlertTitle> : null}
          <AlertDescription>
            <RichContent breaks content={alert.content} />
          </AlertDescription>
          {alert.dismissible ? (
            <AlertAction>
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                aria-label={t('Dismiss alert')}
                onClick={() => dismiss(getAlertDismissKey(alert))}
              >
                <X aria-hidden='true' />
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ))}
    </section>
  )
}
