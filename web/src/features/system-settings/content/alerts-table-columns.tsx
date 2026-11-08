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
import type { StaticDataTableColumn } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { StatusBadge } from '@/components/status-badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ALERT_LEVEL_META,
  ALERT_STATUS_META,
} from '@/features/console-alerts/constants'
import { getAlertStatus } from '@/features/console-alerts/lib/alert-status'
import type { ConsoleAlert } from '@/features/console-alerts/types'
import dayjs from '@/lib/dayjs'

const SCHEDULE_FORMAT = 'YYYY-MM-DD HH:mm'

type BuildAlertColumnsOptions = {
  t: (key: string, options?: Record<string, unknown>) => string
  alerts: ConsoleAlert[]
  selectedIds: number[]
  now: number
  actionsDisabled: boolean
  onToggleAll: (checked: boolean) => void
  onToggleOne: (id: number, checked: boolean) => void
  onEdit: (alert: ConsoleAlert) => void
  onDelete: (alert: ConsoleAlert) => void
}

export function buildAlertColumns(
  props: BuildAlertColumnsOptions
): StaticDataTableColumn<ConsoleAlert>[] {
  return [
    {
      id: 'select',
      className: 'w-12',
      header: (
        <Checkbox
          checked={
            props.alerts.length > 0 &&
            props.selectedIds.length === props.alerts.length
          }
          indeterminate={
            props.selectedIds.length > 0 &&
            props.selectedIds.length < props.alerts.length
          }
          onCheckedChange={(checked) => props.onToggleAll(checked === true)}
          aria-label={props.t('Select all')}
        />
      ),
      cell: (alert) => (
        <Checkbox
          checked={props.selectedIds.includes(alert.id)}
          onCheckedChange={(checked) =>
            props.onToggleOne(alert.id, checked === true)
          }
          aria-label={props.t('Select row')}
        />
      ),
    },
    {
      id: 'alert',
      header: props.t('Alert'),
      cell: (alert) => (
        <div className='flex max-w-md flex-col gap-0.5'>
          {alert.title ? (
            <span className='truncate text-sm font-medium'>{alert.title}</span>
          ) : null}
          <span className='text-muted-foreground truncate text-xs'>
            {alert.content}
          </span>
        </div>
      ),
    },
    {
      id: 'level',
      header: props.t('Level'),
      cell: (alert) => (
        <StatusBadge
          label={props.t(ALERT_LEVEL_META[alert.level].labelKey)}
          variant={ALERT_LEVEL_META[alert.level].badgeVariant}
          copyable={false}
        />
      ),
    },
    {
      id: 'status',
      header: props.t('Status'),
      cell: (alert) => {
        const status = ALERT_STATUS_META[getAlertStatus(alert, props.now)]
        return (
          <StatusBadge
            label={props.t(status.labelKey)}
            variant={status.badgeVariant}
            copyable={false}
          />
        )
      },
    },
    {
      id: 'schedule',
      header: props.t('Schedule'),
      cell: (alert) => {
        if (!alert.startsAt && !alert.endsAt) {
          return (
            <span className='text-muted-foreground text-xs'>
              {props.t('Always')}
            </span>
          )
        }
        return (
          <div className='flex flex-col gap-0.5 text-xs'>
            {alert.startsAt ? (
              <span>
                {props.t('Starts {{time}}', {
                  time: dayjs(alert.startsAt).format(SCHEDULE_FORMAT),
                })}
              </span>
            ) : null}
            {alert.endsAt ? (
              <span>
                {props.t('Ends {{time}}', {
                  time: dayjs(alert.endsAt).format(SCHEDULE_FORMAT),
                })}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'dismissible',
      header: props.t('Dismissible'),
      cell: (alert) => (alert.dismissible ? props.t('Yes') : props.t('No')),
    },
    {
      id: 'actions',
      header: props.t('Actions'),
      cell: (alert) => (
        <StaticRowActions
          editLabel={props.t('Edit')}
          deleteLabel={props.t('Delete')}
          menuLabel={props.t('Open menu')}
          onEdit={() => props.onEdit(alert)}
          onDelete={() => props.onDelete(alert)}
          editDisabled={props.actionsDisabled}
          deleteDisabled={props.actionsDisabled}
        />
      ),
    },
  ]
}
