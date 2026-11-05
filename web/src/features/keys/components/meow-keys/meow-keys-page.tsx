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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, KeyRound, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Main } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useDebounce } from '@/hooks/use-debounce'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getApiKeys, searchApiKeys } from '../../api'
import { ERROR_MESSAGES } from '../../constants'
import { ApiKeysDialogs } from '../api-keys-dialogs'
import { ApiKeysPrimaryButtons } from '../api-keys-primary-buttons'
import { ApiKeysProvider, useApiKeys } from '../api-keys-provider'
import { KEY_ROW_GRID, MeowKeyRow } from './meow-key-row'

const PAGE_SIZE = 20

/** "API" in the title gets the heading orange when a locale starts with it. */
function PageTitle(props: { text: string }) {
  if (!props.text.startsWith('API')) return props.text
  return (
    <>
      <span className='text-meow-heading'>API</span>
      {props.text.slice(3)}
    </>
  )
}

function KeyList() {
  const { t } = useTranslation()
  const { refreshTrigger, setOpen } = useApiKeys()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const keyword = useDebounce(search.trim(), 300)

  const query = useQuery({
    queryKey: ['keys', 'meow', page, PAGE_SIZE, keyword, refreshTrigger],
    queryFn: async () => {
      const result = keyword
        ? await searchApiKeys({ keyword, p: page, size: PAGE_SIZE })
        : await getApiKeys({ p: page, size: PAGE_SIZE })
      if (!result.success) {
        throw createServerError(
          result,
          t(keyword ? ERROR_MESSAGES.SEARCH_FAILED : ERROR_MESSAGES.LOAD_FAILED)
        )
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: keepPreviousData,
  })

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <header className='flex flex-wrap items-end justify-between gap-4'>
        <div className='flex min-w-0 flex-col gap-1'>
          <h1 className='text-2xl font-extrabold tracking-[-0.03em] sm:text-[1.75rem]'>
            <PageTitle text={t('API Keys')} />
          </h1>
          <span className='text-muted-foreground text-sm'>
            {t('One key per project, with its own quota and models.')}
          </span>
        </div>
        <div className='flex w-full flex-wrap items-center gap-2 sm:w-auto'>
          <InputGroup className='bg-card h-9 w-full rounded-[10px] sm:w-56'>
            <InputGroupAddon>
              <Search aria-hidden='true' />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              aria-label={t('Filter by name...')}
              placeholder={t('Filter by name...')}
            />
          </InputGroup>
          <ApiKeysPrimaryButtons />
        </div>
      </header>

      <div className='bg-card border-border overflow-hidden rounded-[22px] border'>
        <div
          className={cn(
            'text-muted-foreground border-border hidden border-b px-6 py-3.5 text-[13px] font-bold',
            KEY_ROW_GRID
          )}
        >
          <span>{t('Name')}</span>
          <span>{t('Key')}</span>
          <span>{t('Models')}</span>
          <span>{t('Quota')}</span>
          <span>{t('Status')}</span>
          <span />
        </div>

        {query.isLoading && (
          <div className='flex flex-col gap-2 p-5'>
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className='h-14 rounded-xl' />
            ))}
          </div>
        )}

        {!query.isLoading && items.length === 0 && (
          <EmptyState
            icon={KeyRound}
            title={keyword ? t('No results found') : t('No API keys yet')}
            description={
              keyword
                ? undefined
                : t('Create one key per project, then paste it into your tool.')
            }
            action={
              keyword ? undefined : (
                <Button
                  className='rounded-xl font-extrabold'
                  onClick={() => setOpen('create')}
                >
                  {t('Create API Key')}
                </Button>
              )
            }
          />
        )}

        {items.length > 0 && (
          <TooltipProvider delay={100}>
            <ul className={cn(query.isFetching && 'opacity-70')}>
              {items.map((item) => (
                <MeowKeyRow key={item.id} apiKey={item} />
              ))}
            </ul>
          </TooltipProvider>
        )}

        <div className='border-border text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3.5 text-[13px]'>
          <span>{t('Group, IP allowlist and expiry are set in Edit.')}</span>
          {pageCount > 1 && (
            <div className='flex items-center gap-1'>
              <Button
                variant='ghost'
                size='icon'
                className='size-8'
                aria-label={t('Previous page')}
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft className='size-4' aria-hidden='true' />
              </Button>
              <span className='tabular-nums'>
                {t('Page {{current}} of {{total}}', {
                  current: page,
                  total: pageCount,
                })}
              </span>
              <Button
                variant='ghost'
                size='icon'
                className='size-8'
                aria-label={t('Next page')}
                disabled={page >= pageCount}
                onClick={() => setPage((value) => value + 1)}
              >
                <ChevronRight className='size-4' aria-hidden='true' />
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * MeowAPI API key page: the design's simpler list on top of the original
 * provider, row actions and create/edit/delete dialogs.
 */
export function MeowApiKeys() {
  return (
    <ApiKeysProvider>
      <Main>
        <div className='min-h-0 flex-1 overflow-auto px-4 pt-6 pb-8 sm:px-8 sm:pt-8'>
          <div className='mx-auto flex w-full max-w-[1440px] flex-col gap-5'>
            <KeyList />
          </div>
        </div>
      </Main>
      <ApiKeysDialogs />
    </ApiKeysProvider>
  )
}
