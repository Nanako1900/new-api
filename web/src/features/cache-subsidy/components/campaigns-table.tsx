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
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { createServerError } from '@/lib/server-error-message'

import { getCampaigns } from '../api'
import { CAMPAIGN_POLL_INTERVAL_MS, ERROR_MESSAGES } from '../constants'
import { cacheSubsidyQueryKeys, isCampaignComputing } from '../lib'
import { useCampaignsColumns } from './campaigns-columns'
import { CampaignsMobileList } from './campaigns-mobile-list'

const route = getRouteApi('/_authenticated/cache-subsidies/')

export function CampaignsTable() {
  const { t } = useTranslation()
  const columns = useCampaignsColumns()
  const isMobile = useMediaQuery('(max-width: 640px)')

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
  })

  const params = {
    p: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
    keyword: globalFilter?.trim() ?? '',
  }
  const { data, isLoading, isFetching } = useQuery({
    queryKey: cacheSubsidyQueryKeys.campaigns(params),
    queryFn: async () => {
      const result = await getCampaigns(params)
      if (!result.success) {
        throw createServerError(result, t(ERROR_MESSAGES.LOAD_FAILED))
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
    // Keep the status column current while a calculation runs.
    refetchInterval: (query) =>
      query.state.data?.items.some((campaign) =>
        isCampaignComputing(campaign.status)
      )
        ? CAMPAIGN_POLL_INTERVAL_MS
        : false,
  })

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    getRowId: (row) => String(row.id),
    globalFilter,
    // The shared toolbar reads the filter state even without filter columns.
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    onGlobalFilterChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total ?? 0,
    ensurePageInRange,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No cache subsidy campaigns')}
      emptyDescription={t(
        'Create a campaign to refund part of the cache cost users paid from their wallets.'
      )}
      skeletonKeyPrefix='cache-subsidy-skeleton'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Filter by name...'),
        searchDebounceMs: 500,
      }}
      mobile={<CampaignsMobileList table={table} isLoading={isLoading} />}
    />
  )
}
