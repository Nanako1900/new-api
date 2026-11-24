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
import { CircleAlert, EyeOff, History, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { RichContent } from '@/components/rich-content'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import {
  ALERT_LEVEL_CLASS,
  ALERT_LEVEL_ICON,
  ALERT_LEVEL_META,
} from '../constants'
import { getAlertStatus } from '../lib/alert-status'
import { getAlertDismissKey } from '../lib/dismiss-key'
import type { ConsoleAlert } from '../types'

const SCHEDULE_FORMAT = 'YYYY-MM-DD HH:mm'

export type AlertHistoryListProps = {
  alerts: ConsoleAlert[]
  dismissedKeys: string[]
  loading: boolean
  onDismissAlert?: (alert: ConsoleAlert) => void
  onRestoreAlert?: (alert: ConsoleAlert) => void
  onRestoreAllAlerts?: () => void
}

/**
 * Renders live (pinned or dismissed) and expired historical console alerts
 * inside the notification bell popover so dismissed or missed alerts remain
 * accessible and restorable.
 */
export function AlertHistoryList(props: AlertHistoryListProps) {
  const { t } = useTranslation()

  if (props.loading) {
    return (
      <EmptyState
        icon={CircleAlert}
        title={t('Loading...')}
        description={t('Latest platform updates and notices')}
        className='min-h-48 border-0 p-4'
      />
    )
  }

  const now = Date.now()
  const liveAlerts: ConsoleAlert[] = []
  const expiredAlerts: ConsoleAlert[] = []
  for (const alert of props.alerts) {
    const status = getAlertStatus(alert, now)
    if (status === 'live') {
      liveAlerts.push(alert)
    } else if (status === 'expired') {
      expiredAlerts.push(alert)
    }
  }

  if (liveAlerts.length === 0 && expiredAlerts.length === 0) {
    return (
      <EmptyState
        icon={CircleAlert}
        title={t('No site alerts')}
        className='min-h-48 border-0 p-4'
      />
    )
  }

  const dismissedLiveCount = liveAlerts.filter(
    (alert) =>
      alert.dismissible &&
      props.dismissedKeys.includes(getAlertDismissKey(alert))
  ).length

  return (
    <ScrollArea className='h-[min(52vh,28rem)] pr-3'>
      <div className='flex flex-col gap-3'>
        {liveAlerts.length > 0 ? (
          <div className='flex flex-col gap-2'>
            <div className='flex items-center justify-between gap-2 px-0.5'>
              <span className='text-muted-foreground text-xs font-medium'>
                {t('Live')} ({liveAlerts.length})
              </span>
              {dismissedLiveCount > 0 && props.onRestoreAllAlerts ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='xs'
                  className='h-6 gap-1 px-1.5 text-xs'
                  onClick={props.onRestoreAllAlerts}
                >
                  <RotateCcw aria-hidden='true' className='size-3' />
                  {t('Restore all')}
                </Button>
              ) : null}
            </div>

            {liveAlerts.map((alert) => {
              const LevelIcon = ALERT_LEVEL_ICON[alert.level]
              const key = getAlertDismissKey(alert)
              const isDismissed =
                alert.dismissible && props.dismissedKeys.includes(key)
              let scheduleLabel = ''
              if (alert.endsAt) {
                scheduleLabel = t('Ends {{time}}', {
                  time: dayjs(alert.endsAt).format(SCHEDULE_FORMAT),
                })
              } else if (alert.startsAt) {
                scheduleLabel = t('Starts {{time}}', {
                  time: dayjs(alert.startsAt).format(SCHEDULE_FORMAT),
                })
              }
              const hasAction =
                alert.dismissible &&
                ((isDismissed && !!props.onRestoreAlert) ||
                  (!isDismissed && !!props.onDismissAlert))

              return (
                <div
                  key={alert.id}
                  className={cn(
                    'rounded-lg border p-3',
                    ALERT_LEVEL_CLASS[alert.level],
                    isDismissed && 'opacity-85'
                  )}
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='flex min-w-0 items-start gap-2'>
                      <LevelIcon
                        aria-hidden='true'
                        className='mt-0.5 size-4 shrink-0'
                      />
                      <span className='sr-only'>
                        {t(ALERT_LEVEL_META[alert.level].labelKey)}
                      </span>
                      <div className='min-w-0 text-sm font-medium [overflow-wrap:anywhere]'>
                        {alert.title ||
                          t(ALERT_LEVEL_META[alert.level].labelKey)}
                      </div>
                    </div>
                    <StatusBadge
                      label={isDismissed ? t('Dismissed') : t('Pinned')}
                      variant={
                        isDismissed
                          ? 'neutral'
                          : ALERT_LEVEL_META[alert.level].badgeVariant
                      }
                      copyable={false}
                      className='shrink-0 text-xs'
                    />
                  </div>

                  <div className='mt-1.5 text-sm'>
                    <RichContent
                      breaks
                      content={alert.content}
                      className='[&_a]:text-foreground'
                    />
                  </div>

                  {scheduleLabel || hasAction ? (
                    <div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
                      <span className='text-muted-foreground text-xs'>
                        {scheduleLabel}
                      </span>
                      {alert.dismissible &&
                      isDismissed &&
                      props.onRestoreAlert ? (
                        <Button
                          type='button'
                          variant='outline'
                          size='xs'
                          className='bg-background/70 h-6 gap-1 text-xs'
                          onClick={() => props.onRestoreAlert?.(alert)}
                        >
                          <RotateCcw aria-hidden='true' className='size-3' />
                          {t('Show at top')}
                        </Button>
                      ) : null}
                      {alert.dismissible &&
                      !isDismissed &&
                      props.onDismissAlert ? (
                        <Button
                          type='button'
                          variant='ghost'
                          size='xs'
                          className='text-muted-foreground hover:text-foreground h-6 gap-1 text-xs'
                          onClick={() => props.onDismissAlert?.(alert)}
                        >
                          <EyeOff aria-hidden='true' className='size-3' />
                          {t('Hide from top')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}

        {liveAlerts.length > 0 && expiredAlerts.length > 0 ? (
          <Separator />
        ) : null}

        {expiredAlerts.length > 0 ? (
          <div className='flex flex-col gap-2'>
            <div className='text-muted-foreground flex items-center gap-1.5 px-0.5 text-xs font-medium'>
              <History aria-hidden='true' className='size-3.5' />
              <span>
                {t('Past alerts')} ({expiredAlerts.length})
              </span>
            </div>

            {expiredAlerts.map((alert) => {
              const LevelIcon = ALERT_LEVEL_ICON[alert.level]
              return (
                <div
                  key={alert.id}
                  className='border-border/70 bg-muted/30 rounded-lg border p-3'
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='flex min-w-0 items-start gap-2'>
                      <LevelIcon
                        aria-hidden='true'
                        className='text-muted-foreground mt-0.5 size-4 shrink-0'
                      />
                      <span className='sr-only'>
                        {t(ALERT_LEVEL_META[alert.level].labelKey)}
                      </span>
                      <div className='min-w-0 text-sm font-medium [overflow-wrap:anywhere]'>
                        {alert.title ||
                          t(ALERT_LEVEL_META[alert.level].labelKey)}
                      </div>
                    </div>
                    <StatusBadge
                      label={t('Expired')}
                      variant='neutral'
                      copyable={false}
                      className='shrink-0 text-xs'
                    />
                  </div>

                  <div className='text-muted-foreground mt-1.5 text-sm'>
                    <RichContent
                      breaks
                      content={alert.content}
                      className='[&_a]:text-foreground'
                    />
                  </div>

                  {alert.endsAt ? (
                    <div className='text-muted-foreground mt-2 text-xs'>
                      {t('Ended {{time}}', {
                        time: dayjs(alert.endsAt).format(SCHEDULE_FORMAT),
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  )
}
