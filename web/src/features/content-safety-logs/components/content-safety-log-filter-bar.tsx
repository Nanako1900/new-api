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
import type { Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'

import { CONTENT_SAFETY_DECISIONS, DECISION_PRESENTATION } from '../constants'
import { isContentSafetyDecision } from '../lib/log-fields'
import type { ContentSafetyLog, ContentSafetyLogFilters } from '../types'

export function ContentSafetyLogFilterBar(props: {
  table: Table<ContentSafetyLog>
  filters: ContentSafetyLogFilters
  onChange: (patch: Partial<ContentSafetyLogFilters>) => void
  isFetching: boolean
  onSearch: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const decisionOptions = [
    { value: 'all', label: t('All decisions') },
    ...CONTENT_SAFETY_DECISIONS.map((decision) => ({
      value: decision,
      label: t(DECISION_PRESENTATION[decision].labelKey),
    })),
  ]
  const dateFilter = (
    <LogsFilterField wide>
      <CompactDateTimeRangePicker
        start={
          props.filters.start_timestamp === undefined
            ? undefined
            : new Date(props.filters.start_timestamp * 1000)
        }
        end={
          props.filters.end_timestamp === undefined
            ? undefined
            : new Date(props.filters.end_timestamp * 1000)
        }
        onChange={({ start, end }) =>
          props.onChange({
            start_timestamp: start
              ? Math.floor(start.getTime() / 1000)
              : undefined,
            end_timestamp: end ? Math.floor(end.getTime() / 1000) : undefined,
          })
        }
      />
    </LogsFilterField>
  )
  const otherFilters = (
    <>
      <LogsFilterField>
        <Combobox
          options={decisionOptions}
          value={props.filters.decision ?? 'all'}
          onValueChange={(value) => {
            if (value === null) return
            props.onChange({
              decision: isContentSafetyDecision(value) ? value : undefined,
            })
          }}
          aria-label={t('Decision')}
          className='w-full'
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('User ID')}
          placeholder={t('User ID')}
          inputMode='numeric'
          value={props.filters.user_id ?? ''}
          onChange={(event) =>
            props.onChange({ user_id: event.target.value.trim() || undefined })
          }
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('Request ID')}
          placeholder={t('Request ID')}
          value={props.filters.request_id ?? ''}
          onChange={(event) =>
            props.onChange({
              request_id: event.target.value.trim() || undefined,
            })
          }
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('Model')}
          placeholder={t('Model')}
          value={props.filters.model ?? ''}
          onChange={(event) =>
            props.onChange({ model: event.target.value || undefined })
          }
        />
      </LogsFilterField>
    </>
  )
  const filterCount = [
    props.filters.decision,
    props.filters.user_id,
    props.filters.model,
    props.filters.request_id,
  ].filter(Boolean).length
  const hasFilters =
    filterCount > 0 ||
    props.filters.start_timestamp !== undefined ||
    props.filters.end_timestamp !== undefined

  return (
    <LogsFilterToolbar
      table={props.table}
      primaryFilters={
        <>
          {dateFilter}
          {otherFilters}
        </>
      }
      mobilePinnedFilters={dateFilter}
      mobileFilters={otherFilters}
      mobileFilterCount={filterCount}
      hasActiveFilters={hasFilters}
      searchLoading={props.isFetching}
      onSearch={props.onSearch}
      onReset={props.onReset}
    />
  )
}
