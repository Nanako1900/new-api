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
import type { Row } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import dayjs from '@/lib/dayjs'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { API_KEY_STATUS, API_KEY_STATUSES } from '../../constants'
import { keyModelLimits, keyQuota } from '../../lib/meow-keys'
import type { ApiKey } from '../../types'
import type { ApiKeyGroupOption } from '../api-key-group-combobox'
import { ApiKeyCell } from '../api-keys-cells'
import { DataTableRowActions } from '../data-table-row-actions'
import { MeowKeyGroupPicker } from './meow-key-group-picker'

/** Shared column template for the header and each row. */
export const KEY_ROW_GRID =
  'lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_6.5rem_12.75rem] lg:items-center lg:gap-4'

const STATUS_DOT: Record<number, string> = {
  [API_KEY_STATUS.ENABLED]: 'bg-success',
  [API_KEY_STATUS.DISABLED]: 'bg-input',
  [API_KEY_STATUS.EXPIRED]: 'bg-warning',
  [API_KEY_STATUS.EXHAUSTED]: 'bg-destructive',
}

function Label(props: { children: string }) {
  return (
    <span className='text-muted-foreground text-[12px] font-semibold lg:hidden'>
      {props.children}
    </span>
  )
}

/** One API key in the MeowAPI list: name, key, group, quota, status. */
export function MeowKeyRow(props: {
  apiKey: ApiKey
  groups: ApiKeyGroupOption[]
  /** The user's groups have loaded, so the key's group can be judged. */
  groupsReady: boolean
}) {
  const { t } = useTranslation()
  const key = props.apiKey
  const quota = keyQuota(key)
  const modelLimits = keyModelLimits(key)
  const groupPicked = props.groups.some((group) => group.value === key.group)
  const status = API_KEY_STATUSES[key.status]
  const enabled = key.status === API_KEY_STATUS.ENABLED
  const expiry =
    key.expired_time === -1
      ? t('Never expires')
      : t('Expires {{date}}', {
          date: dayjs(key.expired_time * 1000).format('YYYY-MM-DD'),
        })

  return (
    <li
      className={cn(
        'border-border/70 flex flex-col gap-3 border-t px-5 py-4 first:border-t-0 lg:px-6',
        KEY_ROW_GRID
      )}
    >
      <div
        className={cn('flex min-w-0 flex-col gap-1', !enabled && 'opacity-60')}
      >
        <span className='truncate text-[15px] font-extrabold'>{key.name}</span>
        <span className='text-muted-foreground text-[12px]'>{expiry}</span>
      </div>

      <div className='bg-muted/70 min-w-0 justify-self-start rounded-[9px] px-2.5 py-1 font-mono text-[13px]'>
        <ApiKeyCell apiKey={key} />
      </div>

      <div
        className={cn('flex min-w-0 flex-col gap-1', !enabled && 'opacity-60')}
      >
        <Label>{t('Group')}</Label>
        {/* The onboarding tour asks for a group when the key has none. */}
        <div
          data-tour='key-row-group'
          data-group-picked={props.groupsReady ? groupPicked : undefined}
          className='w-full max-w-64 lg:max-w-none'
        >
          <MeowKeyGroupPicker apiKey={key} groups={props.groups} />
        </div>
        {modelLimits && (
          <span
            title={modelLimits.join(', ')}
            className='text-muted-foreground truncate text-[12px]'
          >
            {t('Limited models: {{count}}', { count: modelLimits.length })}
          </span>
        )}
      </div>

      <div className={cn('flex flex-col gap-1.5', !enabled && 'opacity-60')}>
        <div className='text-muted-foreground flex justify-between gap-2 text-[12px]'>
          <span>
            {t('Used {{amount}}', { amount: formatQuota(quota.used) })}
          </span>
          <span>
            {quota.limit === null ? t('Unlimited') : formatQuota(quota.limit)}
          </span>
        </div>
        <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
          <div
            className={cn(
              'h-full rounded-full',
              quota.percent >= 90 ? 'bg-destructive' : 'bg-meow-orange'
            )}
            style={{ width: `${quota.percent}%` }}
          />
        </div>
      </div>

      <span className='inline-flex items-center gap-1.5 text-[13px] font-bold'>
        <span
          aria-hidden='true'
          className={cn(
            'size-[7px] rounded-full',
            STATUS_DOT[key.status] ?? 'bg-input'
          )}
        />
        <span className={cn(!enabled && 'text-muted-foreground')}>
          {status ? t(status.label) : t('Unknown')}
        </span>
      </span>

      <div className='flex justify-start lg:justify-end'>
        {/* The table's row actions only read `row.original`. */}
        <DataTableRowActions row={{ original: key } as Row<ApiKey>} />
      </div>
    </li>
  )
}
