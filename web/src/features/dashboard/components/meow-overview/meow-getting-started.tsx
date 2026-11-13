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
import { ArrowRight, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { getApiKeys } from '@/features/keys/api'
import {
  gettingStartedChecklist,
  type ChecklistItemId,
} from '@/features/onboarding/lib/checklist'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import {
  selectOnboardingProgress,
  useOnboardingStore,
} from '@/stores/onboarding-store'

import { MeowGlassPanel } from './meow-glass-panel'
import { MeowPopularModels } from './meow-popular-models'

const ITEM_LABEL: Record<ChecklistItemId, string> = {
  install: 'Install CC Switch',
  'create-key': 'Create an API key',
  import: 'Import into CC Switch',
  'first-call': 'Make your first call',
}

/**
 * Getting-started checklist on the overview. Each open item starts the
 * tour at that point; once all four are done the card shows the popular
 * models instead.
 */
export function MeowGettingStarted() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const progress = useOnboardingStore(selectOnboardingProgress(user?.id))
  const startTour = useOnboardingStore((state) => state.startTour)
  const requestCount = Number(user?.request_count ?? 0)

  const keyCountQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'key-count'],
    queryFn: async () => {
      const result = requireServerSuccess(await getApiKeys({ p: 1, size: 1 }))
      return result.data?.total ?? 0
    },
    staleTime: 60 * 1000,
    // A user who already made requests has every item done.
    enabled: requestCount === 0,
  })

  const items = gettingStartedChecklist({
    installed: progress.installed,
    imported: progress.imported,
    hasKeys: (keyCountQuery.data ?? 0) > 0,
    requestCount,
  })
  const doneCount = items.filter((item) => item.done).length
  if (doneCount === items.length) return <MeowPopularModels />

  const nextItem = items.find((item) => !item.done)

  return (
    <MeowGlassPanel>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <h2 className='text-base font-extrabold'>{t('Setup progress')}</h2>
          <p className='text-muted-foreground text-[13px]'>
            {t('Four steps to connect Claude Code or Codex.')}
          </p>
        </div>
        <span className='text-muted-foreground text-[13px] font-bold tabular-nums'>
          {doneCount}/{items.length}
        </span>
      </div>

      <div
        aria-hidden='true'
        className='h-1.5 overflow-hidden rounded-full bg-white/70 dark:bg-white/10'
      >
        <div
          className='bg-primary h-full rounded-full transition-[width] duration-500'
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>

      <ol className='flex flex-col'>
        {items.map((item) => (
          <li key={item.id} className='flex min-h-12 items-center gap-3 py-1.5'>
            <span
              aria-hidden='true'
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border',
                item.done
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-input bg-white/70 dark:bg-white/5'
              )}
            >
              {item.done && <Check className='size-3.5' strokeWidth={3} />}
            </span>
            <span className='flex min-w-0 flex-1 flex-col'>
              <span
                className={cn(
                  'text-sm font-bold',
                  item.done && 'text-muted-foreground line-through'
                )}
              >
                <span className='sr-only'>
                  {item.done ? t('Done') : t('To do')}:{' '}
                </span>
                {t(ITEM_LABEL[item.id])}
              </span>
              {item.id === 'first-call' && !item.done && (
                <span className='text-muted-foreground text-xs'>
                  {t('Send a message from Claude Code or Codex.')}
                </span>
              )}
            </span>
            {!item.done && item.tourStart && user && (
              <Button
                size='sm'
                variant={item === nextItem ? 'default' : 'outline'}
                className='h-8 rounded-[9px] font-bold'
                onClick={() => startTour(user.id, item.tourStart)}
              >
                {t('Go')}
                <ArrowRight aria-hidden='true' />
              </Button>
            )}
          </li>
        ))}
      </ol>
    </MeowGlassPanel>
  )
}
