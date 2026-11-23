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
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota, formatTimestampToDate } from '@/lib/format'
import { createServerError } from '@/lib/server-error-message'

import { getCampaignGrants } from '../api'
import {
  ERROR_MESSAGES,
  GRANT_STATUSES,
  GRANT_STATUS_VALUES,
} from '../constants'
import { cacheSubsidyQueryKeys } from '../lib'
import type { Campaign, Grant, GrantStatus } from '../types'

const DEFAULT_PAGINATION: PaginationState = { pageIndex: 0, pageSize: 10 }

function useGrantColumns(): ColumnDef<Grant>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return useMemo(
    () => [
      {
        accessorKey: 'username',
        header: t('Username'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='flex flex-col leading-5'>
            <span className='font-medium'>{row.original.username}</span>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {t('User ID')}: {row.original.user_id}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'log_count',
        header: t('Logs'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatNumber(row.original.log_count, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'cache_read_tokens',
        header: t('Cache read tokens'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatNumber(row.original.cache_read_tokens, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'cache_write_tokens',
        header: t('Cache write tokens'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatNumber(row.original.cache_write_tokens, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'cache_quota',
        header: t('Cache cost'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatQuota(row.original.cache_quota)}
          </span>
        ),
      },
      {
        accessorKey: 'subsidy_quota',
        header: t('Subsidy'),
        cell: ({ row }) => (
          <span className='font-semibold tabular-nums'>
            {formatQuota(row.original.subsidy_quota)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => {
          const config = GRANT_STATUSES[row.original.status]
          if (!config) return null
          return (
            <StatusBadge
              label={t(config.labelKey)}
              variant={config.variant}
              copyable={false}
              className='-ml-1.5'
            />
          )
        },
      },
      {
        accessorKey: 'claimed_at',
        header: t('Claimed at'),
        cell: ({ row }) => (
          <span className='font-mono text-xs'>
            {formatTimestampToDate(row.original.claimed_at)}
          </span>
        ),
      },
    ],
    [t, locale]
  )
}

/** Every user's precomputed subsidy in a campaign, filtered on the server. */
export function CampaignGrantsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaign?: Campaign
}) {
  const { t } = useTranslation()
  const columns = useGrantColumns()
  const id = props.campaign?.id ?? 0
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION)
  const [keyword, setKeyword] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const statusFilter = columnFilters.find((filter) => filter.id === 'status')
  const status = ((statusFilter?.value as string[] | undefined)?.[0] ?? '') as
    | GrantStatus
    | ''

  const params = {
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
    keyword: keyword.trim(),
    status,
  }
  const grantsQuery = useQuery({
    queryKey: cacheSubsidyQueryKeys.grants(id, params),
    queryFn: async () => {
      const result = await getCampaignGrants(id, params)
      if (!result.success) {
        throw createServerError(result, t(ERROR_MESSAGES.LOAD_GRANTS_FAILED))
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    enabled: props.open && props.campaign !== undefined,
    placeholderData: (previousData) => previousData,
  })

  const resetToFirstPage = () =>
    setPagination((previous) => ({ ...previous, pageIndex: 0 }))

  const { table } = useDataTable({
    data: grantsQuery.data?.items ?? [],
    columns,
    getRowId: (row) => String(row.id),
    globalFilter: keyword,
    onGlobalFilterChange: (updater) => {
      setKeyword((previous) =>
        typeof updater === 'function' ? updater(previous) : updater
      )
      resetToFirstPage()
    },
    columnFilters,
    onColumnFiltersChange: (updater) => {
      setColumnFilters((previous) =>
        typeof updater === 'function' ? updater(previous) : updater
      )
      resetToFirstPage()
    },
    pagination,
    onPaginationChange: setPagination,
    manualPagination: true,
    manualFiltering: true,
    totalCount: grantsQuery.data?.total ?? 0,
    columnVisibilityStorageKey: false,
    columnSizingStorageKey: false,
  })

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setPagination(DEFAULT_PAGINATION)
          setKeyword('')
          setColumnFilters([])
        }
        props.onOpenChange(open)
      }}
      title={t('Grants · {{name}}', { name: props.campaign?.name ?? '' })}
      description={t('Each user’s cache cost and subsidy in this campaign.')}
      contentClassName='sm:max-w-5xl'
    >
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={grantsQuery.isLoading}
        isFetching={grantsQuery.isFetching}
        emptyTitle={t('No grants')}
        emptyDescription={t('No users match these filters.')}
        skeletonKeyPrefix='cache-subsidy-grants-skeleton'
        fixedHeight={false}
        paginationInFooter={false}
        toolbarProps={{
          searchPlaceholder: t('Filter by username or user ID...'),
          searchDebounceMs: 500,
          hideViewOptions: true,
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              singleSelect: true,
              options: GRANT_STATUS_VALUES.map((value) => ({
                label: t(GRANT_STATUSES[value].labelKey),
                value,
              })),
            },
          ],
        }}
      />
    </Dialog>
  )
}
