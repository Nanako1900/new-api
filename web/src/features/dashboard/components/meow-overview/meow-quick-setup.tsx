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
import { Link } from '@tanstack/react-router'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useStatus } from '@/hooks/use-status'
import { resolveApiRoot } from '@/lib/api-root'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  buildSetupSnippet,
  maskApiKey,
  SETUP_CLIENTS,
  type SetupClient,
} from '../../lib/meow-setup'

/**
 * Frosted-glass quick setup: config for the user's first enabled key. The
 * snippet shows a masked key; copying fetches the full key first.
 */
export function MeowQuickSetup() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const [client, setClient] = useState<SetupClient>('claude-code')
  const [isCopying, setIsCopying] = useState(false)
  const { copiedText, copyToClipboard } = useCopyToClipboard()

  const keysQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'api-keys'],
    queryFn: async () => {
      const result = requireServerSuccess(await getApiKeys({ p: 1, size: 10 }))
      return result.success ? (result.data?.items ?? []) : []
    },
    staleTime: 60 * 1000,
  })

  const keys = keysQuery.data ?? []
  const preferredKey = keys.find((item) => item.status === 1) ?? keys[0]
  const apiRoot = resolveApiRoot(status, window.location.origin)
  const snippet = buildSetupSnippet(
    client,
    apiRoot,
    maskApiKey(preferredKey?.key)
  )

  const handleCopy = async () => {
    if (!preferredKey) return
    setIsCopying(true)
    try {
      const result = await fetchTokenKey(preferredKey.id)
      const key = result.success ? result.data?.key : ''
      if (!key) {
        handleServerError(result, t('Failed to copy to clipboard'))
        return
      }
      await copyToClipboard(
        buildSetupSnippet(
          client,
          apiRoot,
          key.startsWith('sk-') ? key : `sk-${key}`
        )
      )
    } catch (error) {
      handleServerError(error, t('Failed to copy to clipboard'))
    } finally {
      setIsCopying(false)
    }
  }

  const copied = copiedText !== null

  return (
    <div className='relative'>
      <div
        aria-hidden='true'
        className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-6 -left-4 h-40 w-60 rounded-full opacity-55 blur-[50px]'
      />
      <div
        aria-hidden='true'
        className='meow-drift-b bg-meow-ink pointer-events-none absolute top-16 right-6 size-44 rounded-full opacity-25 blur-[54px] dark:bg-white dark:opacity-10'
      />
      <div className='relative isolate flex h-full flex-col gap-4 rounded-[22px] border border-white/80 bg-white/55 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_24px_48px_-30px_rgba(30,27,23,0.3)] dark:border-white/10 dark:bg-white/[0.05] dark:shadow-none'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h2 className='text-base font-extrabold'>{t('Quick setup')}</h2>
          <Tabs
            value={client}
            onValueChange={(value) => setClient(value as SetupClient)}
          >
            <TabsList variant='line' className='h-auto gap-1 p-0'>
              {SETUP_CLIENTS.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className='data-active:bg-primary! data-active:text-primary-foreground! h-8 rounded-[9px] px-3 text-[13px] font-bold after:hidden'
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <pre className='overflow-x-auto rounded-[14px] bg-white/60 px-4 py-3.5 font-mono text-[13px] leading-[1.8] dark:bg-black/30'>
          {snippet}
        </pre>

        <div className='mt-auto flex flex-wrap items-center gap-3 text-[13px]'>
          {preferredKey ? (
            <>
              <span className='text-muted-foreground min-w-0 flex-1 truncate font-mono'>
                {maskApiKey(preferredKey.key)}
                <span className='font-sans'>
                  {' · '}
                  <b className='text-foreground font-bold'>
                    {preferredKey.name}
                  </b>
                </span>
              </span>
              <Button
                variant='outline'
                className='h-9 rounded-[10px] bg-white/60 font-bold dark:bg-white/5'
                onClick={handleCopy}
                disabled={isCopying}
              >
                {copied ? (
                  <Check className='size-4' aria-hidden='true' />
                ) : (
                  <Copy className='size-4' aria-hidden='true' />
                )}
                {t('Copy config')}
              </Button>
            </>
          ) : (
            <>
              <span className='text-muted-foreground min-w-0 flex-1'>
                {t('Create a key first, then copy the config.')}
              </span>
              <Button
                className='h-9 rounded-[10px] font-extrabold'
                render={<Link to='/keys' />}
              >
                {t('Create API Key')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
