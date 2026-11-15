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
import { lazy, type ReactNode, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { usePricingPreferencesStore } from '@/stores/pricing-preferences-store'

import {
  usePricingData,
  usePricingReference,
} from '../../hooks/use-pricing-data'
import { buildMeowChannels } from '../../lib/meow-catalog'
import { MeowChannelModels } from './meow-channel-models'
import { MeowChannelPicker } from './meow-channel-picker'
import type { MeowPriceOptions } from './meow-model-row'

// The drawer pulls in the charts and only mounts once a model is picked.
const ModelDetailsDrawer = lazy(() =>
  import('../model-details').then((module) => ({
    default: module.ModelDetailsDrawer,
  }))
)

const SKELETON_KEYS = ['claude', 'gpt'] as const

type MeowPricingCatalogProps = {
  group?: string
  onGroupChange?: (group: string) => void
}

/** Browse a single public channel while retaining its price context. */
export function MeowPricingCatalog(props: MeowPricingCatalogProps) {
  const { t } = useTranslation()
  const pricing = usePricingData()
  const reference = usePricingReference()
  const rememberedGroup = usePricingPreferencesStore((state) => state.group)
  const setGroup = usePricingPreferencesStore((state) => state.setGroup)
  const [selectedModelName, setSelectedModelName] = useState<string | null>(
    null
  )

  const channels = useMemo(
    () =>
      buildMeowChannels(
        pricing.models,
        pricing.usableGroup,
        pricing.groupRatio
      ),
    [pricing.models, pricing.usableGroup, pricing.groupRatio]
  )
  const activeChannel =
    channels.find((channel) => channel.group === props.group) ??
    channels.find((channel) => channel.group === rememberedGroup) ??
    channels[0]

  const prices: MeowPriceOptions = {
    priceRate: pricing.priceRate,
    usdExchangeRate: pricing.usdExchangeRate,
    groupRatio: pricing.groupRatio,
    reference: reference.data,
  }
  const selectedModel =
    activeChannel?.models.find(
      (model) => model.model_name === selectedModelName
    ) ?? null

  let body: ReactNode
  if (pricing.isLoading) {
    body = (
      <div className='space-y-5'>
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} className='h-56 w-full rounded-2xl' />
        ))}
      </div>
    )
  } else if (pricing.error && pricing.models.length === 0) {
    body = (
      <ErrorState
        title={t('Failed to load models')}
        onRetry={() => void pricing.refetch()}
      />
    )
  } else if (!activeChannel) {
    body = <EmptyState title={t('No models available')} bordered />
  } else {
    body = (
      <>
        <MeowChannelPicker
          channels={channels}
          value={activeChannel.group}
          onChange={(group) => {
            setSelectedModelName(null)
            setGroup(group)
            props.onGroupChange?.(group)
          }}
        />
        <MeowChannelModels
          key={activeChannel.group}
          channel={activeChannel}
          prices={prices}
          onSelect={setSelectedModelName}
        />
      </>
    )
  }

  return (
    <div className='mx-auto w-full max-w-6xl'>
      <header className='mb-5 pt-4 sm:pt-5'>
        <h1 className='text-3xl font-bold tracking-tight sm:text-4xl'>
          {t('Models and prices')}
        </h1>
        <p className='text-muted-foreground mt-2 text-sm'>
          {t(
            'Spend less on the models you use. Compare channel prices with reference rates.'
          )}
        </p>
      </header>

      {body}

      {selectedModel && (
        <Suspense fallback={null}>
          <ModelDetailsDrawer
            open
            onOpenChange={(open) => {
              if (!open) setSelectedModelName(null)
            }}
            model={selectedModel}
            selectedGroup={activeChannel?.group}
            groupRatio={pricing.groupRatio}
            usableGroup={pricing.usableGroup}
            endpointMap={
              pricing.endpointMap as Record<
                string,
                { path?: string; method?: string }
              >
            }
            autoGroups={pricing.autoGroups}
            priceRate={pricing.priceRate}
            usdExchangeRate={pricing.usdExchangeRate}
            tokenUnit='M'
            showRechargePrice={false}
          />
        </Suspense>
      )}
    </div>
  )
}
