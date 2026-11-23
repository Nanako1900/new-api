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
import { ChevronDown, Globe } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import type { ApiInfoItem } from '@/features/dashboard/types'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { getBgColorClass } from '@/lib/colors'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

function AddressRow({
  address,
  showDescription,
}: {
  address: ApiInfoItem
  showDescription: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-x-3'>
      <span className='text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-xs font-medium'>
        {address.color && (
          <span
            aria-hidden='true'
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              getBgColorClass(address.color)
            )}
          />
        )}
        <span className='[overflow-wrap:anywhere] break-words'>
          {address.route}
        </span>
      </span>
      <span className='inline-flex max-w-full min-w-0 items-center gap-1'>
        <code className='min-w-0 font-mono text-xs break-all select-text sm:text-[13px]'>
          {address.url}
        </code>
        <CopyButton
          value={address.url}
          className='size-11 sm:size-8'
          iconClassName='size-3.5'
          tooltip={t('Copy API URL')}
          aria-label={`${t('Copy API URL')}: ${address.url}`}
        />
      </span>
      {showDescription && address.description && (
        <span className='text-muted-foreground text-xs [overflow-wrap:anywhere]'>
          {address.description}
        </span>
      )}
    </div>
  )
}

export function ApiAddressStrip() {
  const { t, i18n } = useTranslation()
  const { status, loading } = useStatus()
  const { items } = useApiInfo()
  const [open, setOpen] = useState(false)
  const [configured, ...others] = items
  const serverAddress =
    typeof status?.server_address === 'string'
      ? status.server_address.trim()
      : ''
  const first = configured ?? {
    url: serverAddress || window.location.origin,
    route: serverAddress ? t('Default API address') : t('Current domain'),
    description: '',
    color: '',
  }
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      render={<section aria-label={t('API Addresses')} />}
      className='bg-card/60 border-border shrink-0 rounded-xl border px-3 sm:px-4'
    >
      <div className='grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]'>
        <h2 className='text-muted-foreground inline-flex items-center gap-2 py-2 text-xs font-semibold sm:border-r sm:py-0 sm:pr-4'>
          <Globe className='size-4' aria-hidden='true' />
          {t('API Addresses')}
        </h2>
        <div className='col-span-2 row-start-2 min-w-0 pb-1 sm:col-span-1 sm:row-auto sm:py-1'>
          {loading ? (
            <LoadingState inline size='sm' message={t('Loading...')} />
          ) : (
            <AddressRow address={first} showDescription={!others.length} />
          )}
        </div>
        {others.length > 0 && (
          <CollapsibleTrigger
            render={<Button variant='ghost' size='sm' />}
            className='text-muted-foreground col-start-2 row-start-1 min-h-11 px-1.5 text-xs sm:col-start-3 sm:min-h-8'
          >
            {open ? t('Hide routes') : t('More routes')}
            {!open && (
              <span className='bg-muted rounded px-1 text-[11px] tabular-nums'>
                {formatNumber(others.length, toIntlLocale(i18n.language))}
              </span>
            )}
            <ChevronDown
              aria-hidden='true'
              className={cn('size-3.5', open && 'rotate-180')}
            />
          </CollapsibleTrigger>
        )}
      </div>
      {others.length > 0 && (
        <CollapsibleContent className='border-border divide-border divide-y border-t'>
          {first.description && (
            <p className='text-muted-foreground py-2 text-xs [overflow-wrap:anywhere]'>
              {first.route} · {first.description}
            </p>
          )}
          {others.map((address) => (
            <div key={`${address.route}:${address.url}`} className='py-1'>
              <AddressRow address={address} showDescription />
            </div>
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
