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
import { getRouteApi } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useAuditForbiddenRedirect } from '@/features/content-safety-logs/hooks/use-audit-forbidden-redirect'

import { useRiskProfiles } from '../api'
import { RISK_PROFILE_PAGE_SIZE } from '../constants'
import type {
  RiskProfile,
  RiskProfileAction,
  RiskProfileFilters,
  RiskView,
} from '../types'
import { RiskProfileActionDialog } from './risk-profile-action-dialog'
import { useRiskProfileColumns } from './risk-profile-columns'
import { RiskProfileFilterBar } from './risk-profile-filter-bar'

const route = getRouteApi('/_authenticated/usage-logs/content-risk')
const EMPTY_PROFILES: RiskProfile[] = []

export function RiskProfileTable() {
  const { t } = useTranslation()
  // The URL holds every filter, so a link can open the page filtered.
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const filters: RiskProfileFilters = {
    p: search.page ?? 1,
    page_size: search.pageSize ?? RISK_PROFILE_PAGE_SIZE,
    view: search.view ?? 'enforce',
    level: search.level,
    trusted: search.trusted,
    user_id: search.user_id,
    username: search.username,
  }
  const query = useRiskProfiles(filters)
  useAuditForbiddenRedirect(query.error)
  const [pending, setPending] = useState<RiskProfileAction | null>(null)
  const columns = useRiskProfileColumns(filters.view, setPending)
  const { table } = useDataTable({
    columns,
    data: query.isError
      ? EMPTY_PROFILES
      : (query.data?.items ?? EMPTY_PROFILES),
    getRowId: (profile) => String(profile.user_id),
    totalCount: query.isError ? 0 : (query.data?.total ?? 0),
    pagination: { pageIndex: filters.p - 1, pageSize: filters.page_size },
    onPaginationChange: (updater) => {
      if (query.isFetching || query.isError) return
      const current = { pageIndex: filters.p - 1, pageSize: filters.page_size }
      const next = typeof updater === 'function' ? updater(current) : updater
      const page = next.pageSize === filters.page_size ? next.pageIndex + 1 : 1
      void navigate({
        search: (previous) => ({
          ...previous,
          page: page > 1 ? page : undefined,
          pageSize: next.pageSize,
        }),
      })
    },
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })
  const updateSearch = (patch: {
    view?: RiskView
    level?: RiskProfileFilters['level']
    trusted?: boolean
    user_id?: number
    username?: string
  }) =>
    void navigate({
      search: (previous) => ({ ...previous, ...patch, page: undefined }),
    })

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        emptyTitle={
          query.isError ? t('Failed to load risk profiles') : t('No records')
        }
        paginationInFooter
        className='h-auto min-h-0 flex-1'
        applyHeaderSize
        getColumnClassName={() => 'py-2'}
        toolbar={
          <div className='shrink-0 space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-muted-foreground text-sm'>
                {filters.view === 'shadow'
                  ? t(
                      'Shadow scores come from shadow mode. They never act and show who would be blocked.'
                    )
                  : t(
                      'Scores that act while AI review is enforcing. Trusted accounts are never held back.'
                    )}
              </p>
              <ToggleGroup
                value={[filters.view]}
                onValueChange={(value) => {
                  if (value[0] === 'enforce' || value[0] === 'shadow') {
                    updateSearch({ view: value[0] })
                  }
                }}
                aria-label={t('Score view')}
                variant='outline'
                size='sm'
              >
                <ToggleGroupItem value='enforce'>
                  {t('Enforce')}
                </ToggleGroupItem>
                <ToggleGroupItem value='shadow'>{t('Shadow')}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <RiskProfileFilterBar
              table={table}
              filters={filters}
              onChange={updateSearch}
              isFetching={query.isFetching}
              onRefresh={() => void query.refetch()}
              onReset={() =>
                void navigate({
                  search: {
                    view: search.view,
                    pageSize: search.pageSize,
                  },
                })
              }
            />
            {query.isError && (
              <Alert variant='destructive'>
                <AlertDescription className='flex items-center justify-between gap-2'>
                  <span>{t('Failed to load risk profiles')}</span>
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
      <RiskProfileActionDialog
        pending={pending}
        onClose={() => setPending(null)}
      />
    </div>
  )
}
