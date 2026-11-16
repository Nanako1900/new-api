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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'

import { getInvitees } from '../api'

export function AffiliateInvitees(props: { userId: number }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['affiliate', props.userId, 'invitees', page],
    queryFn: () => getInvitees(props.userId, page),
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className='space-y-3'>
      <StaticDataTable
        data={query.data.items}
        getRowKey={(user) => user.id}
        emptyContent={t('No invited users yet')}
        columns={[
          { id: 'id', header: t('ID'), cell: (user) => user.id },
          {
            id: 'username',
            header: t('Username'),
            cell: (user) => user.username,
          },
          {
            id: 'name',
            header: t('Display name'),
            cell: (user) => user.display_name,
          },
        ]}
      />
      <div className='flex justify-end gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={page === 1 || query.isFetching}
          onClick={() => setPage(page - 1)}
        >
          {t('Previous')}
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={page * 10 >= query.data.total || query.isFetching}
          onClick={() => setPage(page + 1)}
        >
          {t('Next')}
        </Button>
      </div>
    </div>
  )
}
