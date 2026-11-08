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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { useContentSafetyLogs } from '../api'
import { CONTENT_SAFETY_LOG_PAGE_SIZE } from '../constants'
import type {
  ContentSafetyLog,
  ContentSafetyLogFieldErrors,
  ContentSafetyLogFilters,
} from '../types'
import { useContentSafetyLogColumns } from './content-safety-log-columns'
import { ContentSafetyLogFilterBar } from './content-safety-log-filter-bar'

const EMPTY_LOGS: ContentSafetyLog[] = []
// The backend accepts only positive integer user IDs that fit an int64.
const USER_ID_PATTERN = /^[1-9]\d*$/
const USER_ID_MAX_DIGITS = 18
// The backend measures these limits in bytes.
const REQUEST_ID_MAX_BYTES = 64
const MODEL_MAX_BYTES = 255

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function ContentSafetyLogTable() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<ContentSafetyLogFilters>({
    p: 1,
    page_size: CONTENT_SAFETY_LOG_PAGE_SIZE,
  })
  const invalidRange =
    filters.start_timestamp !== undefined &&
    filters.end_timestamp !== undefined &&
    filters.start_timestamp > filters.end_timestamp
  const fieldErrors: ContentSafetyLogFieldErrors = {}
  if (filters.user_id !== undefined) {
    if (!USER_ID_PATTERN.test(filters.user_id)) {
      fieldErrors.user_id = t('User ID must be a positive integer')
    } else if (filters.user_id.length > USER_ID_MAX_DIGITS) {
      fieldErrors.user_id = t('User ID is too long')
    }
  }
  if (
    filters.request_id !== undefined &&
    byteLength(filters.request_id) > REQUEST_ID_MAX_BYTES
  ) {
    fieldErrors.request_id = t('Request ID is too long')
  }
  if (
    filters.model !== undefined &&
    byteLength(filters.model) > MODEL_MAX_BYTES
  ) {
    fieldErrors.model = t('Model name is too long')
  }
  const canQuery = !invalidRange && Object.keys(fieldErrors).length === 0
  const query = useContentSafetyLogs(filters, canQuery)
  const columns = useContentSafetyLogColumns()
  const { table } = useDataTable({
    columns,
    data: query.isError ? EMPTY_LOGS : (query.data?.items ?? EMPTY_LOGS),
    getRowId: (entry) => entry.event_id,
    totalCount: query.isError ? 0 : (query.data?.total ?? 0),
    pagination: { pageIndex: filters.p - 1, pageSize: filters.page_size },
    onPaginationChange: (updater) => {
      if (query.isFetching || query.isError || !canQuery) return
      setFilters((previous) => {
        const current = {
          pageIndex: previous.p - 1,
          pageSize: previous.page_size,
        }
        const next = typeof updater === 'function' ? updater(current) : updater
        return {
          ...previous,
          p: next.pageSize === previous.page_size ? next.pageIndex + 1 : 1,
          page_size: next.pageSize,
        }
      })
    },
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })
  const update = (patch: Partial<ContentSafetyLogFilters>) =>
    setFilters((previous) => ({ ...previous, ...patch, p: 1 }))

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isPending && canQuery}
        isFetching={query.isFetching}
        emptyTitle={
          query.isError
            ? t('Failed to load content safety logs')
            : t('No records')
        }
        paginationInFooter
        className='h-auto min-h-0 flex-1'
        applyHeaderSize
        getColumnClassName={() => 'py-2'}
        toolbar={
          <div className='shrink-0 space-y-2'>
            <ContentSafetyLogFilterBar
              table={table}
              filters={filters}
              errors={fieldErrors}
              onChange={update}
              isFetching={query.isFetching}
              onSearch={() => {
                if (canQuery) void query.refetch()
              }}
              onReset={() => setFilters({ p: 1, page_size: filters.page_size })}
            />
            {invalidRange && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t('End time must be after start time')}
                </AlertDescription>
              </Alert>
            )}
            {query.isError && (
              <Alert variant='destructive'>
                <AlertDescription className='flex items-center justify-between gap-2'>
                  <span>{t('Failed to load content safety logs')}</span>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => void query.refetch()}
                  >
                    {t('Retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        }
      />
    </div>
  )
}
