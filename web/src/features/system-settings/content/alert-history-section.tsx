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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { deleteAlertHistoryEntry } from '@/features/console-alerts/api'
import {
  ALERT_HISTORY_QUERY_KEY,
  ALERT_LEVEL_META,
  ALERT_LEVELS,
} from '@/features/console-alerts/constants'
import type { AlertHistoryEntry } from '@/features/console-alerts/types'
import dayjs from '@/lib/dayjs'
import { requireServerSuccess } from '@/lib/server-error-message'

import { SettingsSection } from '../components/settings-section'

const PUBLISHED_FORMAT = 'YYYY-MM-DD HH:mm'

type AlertHistorySectionProps = {
  /** Stored `console_setting.alert_history` JSON */
  history: string
  /** Stored `console_setting.alerts` JSON; listed alerts cannot be removed */
  alerts: string
}

/**
 * Alerts users can still read in the header bell after they end or are
 * deleted. The server keeps this list; removing an entry deletes it for
 * every user.
 */
export function AlertHistorySection(props: AlertHistorySectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingRemoval, setPendingRemoval] =
    useState<AlertHistoryEntry | null>(null)

  const { entries, listedIds } = useMemo(() => {
    const parsed = {
      entries: [] as AlertHistoryEntry[],
      listedIds: [] as number[],
    }
    try {
      const history: unknown = JSON.parse(props.history || '[]')
      if (Array.isArray(history)) {
        parsed.entries = history.filter(
          (item): item is AlertHistoryEntry =>
            typeof item === 'object' &&
            item !== null &&
            typeof item.id === 'number' &&
            ALERT_LEVELS.includes(item.level)
        )
      }
      const alerts: unknown = JSON.parse(props.alerts || '[]')
      if (Array.isArray(alerts)) {
        parsed.listedIds = alerts.map((alert) => alert?.id)
      }
    } catch {
      // A damaged value shows as an empty history; the server rebuilds it.
    }
    return parsed
  }, [props.history, props.alerts])

  const removeEntry = useMutation({
    mutationFn: async (id: number) =>
      requireServerSuccess(await deleteAlertHistoryEntry(id)),
    onSuccess: () => {
      toast.success(t('Removed from history'))
      queryClient.invalidateQueries({ queryKey: ['system-options'] })
      queryClient.invalidateQueries({ queryKey: ALERT_HISTORY_QUERY_KEY })
    },
  })

  return (
    <SettingsSection title={t('Alert history')}>
      <p className='text-muted-foreground mb-4 text-sm'>
        {t(
          'Alerts users can still read in the bell after they end or are deleted. Remove one here to delete it for everyone.'
        )}
      </p>
      <StaticDataTable
        data={entries}
        getRowKey={(entry) => entry.id}
        emptyContent={t('No alert history yet')}
        columns={[
          {
            id: 'alert',
            header: t('Alert'),
            cell: (entry) => (
              <div className='flex max-w-md flex-col gap-0.5'>
                {entry.title ? (
                  <span className='truncate text-sm font-medium'>
                    {entry.title}
                  </span>
                ) : null}
                <span className='text-muted-foreground truncate text-xs'>
                  {entry.content}
                </span>
              </div>
            ),
          },
          {
            id: 'level',
            header: t('Level'),
            cell: (entry) => (
              <StatusBadge
                label={t(ALERT_LEVEL_META[entry.level].labelKey)}
                variant={ALERT_LEVEL_META[entry.level].badgeVariant}
                copyable={false}
              />
            ),
          },
          {
            id: 'published',
            header: t('Published'),
            cell: (entry) => (
              <span className='text-xs'>
                {dayjs(entry.publishedAt).format(PUBLISHED_FORMAT)}
              </span>
            ),
          },
          {
            id: 'status',
            header: t('Status'),
            cell: (entry) =>
              listedIds.includes(entry.id) ? (
                <StatusBadge
                  label={t('In alert list')}
                  variant='info'
                  copyable={false}
                />
              ) : (
                <StatusBadge
                  label={t('Deleted from alert list')}
                  variant='neutral'
                  copyable={false}
                />
              ),
          },
          {
            id: 'actions',
            header: t('Actions'),
            cell: (entry) => {
              const listed = listedIds.includes(entry.id)
              return (
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  disabled={listed || removeEntry.isPending}
                  title={
                    listed
                      ? t('Delete it from the alert list and save first')
                      : undefined
                  }
                  onClick={() => setPendingRemoval(entry)}
                >
                  <Trash2 className='mr-1.5 h-4 w-4' aria-hidden='true' />
                  {t('Remove from history')}
                </Button>
              )
            },
          },
        ]}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null)
        }}
        title={t('Remove from history?')}
        desc={t(
          'Users will no longer see this alert in the bell. This cannot be undone.'
        )}
        confirmText={t('Remove from history')}
        destructive
        isLoading={removeEntry.isPending}
        handleConfirm={() => {
          if (!pendingRemoval) return
          removeEntry.mutate(pendingRemoval.id, {
            onSettled: () => setPendingRemoval(null),
          })
        }}
      />
    </SettingsSection>
  )
}
