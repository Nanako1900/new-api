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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PluginIcon } from '@/features/task-plugins/components/plugin-icon'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { ParsedTaskTier } from '../lib/billing-expr'
import { formatBillingCondition } from '../lib/billing-expression/condition-display'
import {
  formatTaskUsageUnitPrice,
  getDynamicPriceEntries,
  getDynamicPriceUnitLabelKey,
  getDynamicPricingTiers,
  hasDynamicRequestRules,
  getTaskUsageQuantityUnitLabelKey,
  isDynamicPricingModel,
  isUnconfiguredTaskUsageModel,
  type DynamicPriceEntry,
} from '../lib/dynamic-price'
import {
  getAvailableGroups,
  getConfiguredGroupRatio,
  isTokenBasedModel,
} from '../lib/model-helpers'
import { withOrdinaryPricing, withPluginPricing } from '../lib/plugin-pricing'
import { formatFixedPrice, formatGroupPrice } from '../lib/price'
import {
  evaluateTaskUsageExamples,
  getTaskEnumFields,
  getTaskNumberFields,
} from '../lib/task-expr'
import { getTaskPricingDisplayTiers } from '../lib/task-matrix-display'
import {
  hasSimpleTaskPricing,
  taskPriceLabel,
  taskUsageUnitLabel,
  taskTierConditions,
  pricingDisplayFallbackKey,
} from '../lib/task-price-display'
import type { PriceType, PricingModel, TokenUnit } from '../types'
import { DynamicPricingBreakdown } from './dynamic-pricing-breakdown'

function SectionTitle(props: { children: React.ReactNode }) {
  return (
    <h2 className='text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase'>
      {props.children}
    </h2>
  )
}

export function DynamicPriceEntryLabel(props: { entry: DynamicPriceEntry }) {
  const { t, i18n } = useTranslation()
  if (props.entry.labelKind === 'schema') {
    return (
      <span className='break-words whitespace-normal'>
        {taskPriceLabel(
          props.entry.description,
          props.entry.shortLabel,
          i18n.language
        )}
      </span>
    )
  }
  return t(props.entry.shortLabel)
}

export function UnconfiguredTaskPricingNotice(props: { model: PricingModel }) {
  const { t, i18n } = useTranslation()
  const numberFields = getTaskNumberFields(props.model.billing_usage_schema)
  const enumFields = getTaskEnumFields(props.model.billing_usage_schema)

  return (
    <div className='bg-muted/20 flex flex-col gap-3 rounded-lg border p-3'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'This model is billed by usage, but the administrator has not configured its pricing yet.'
        )}
      </p>
      {numberFields.length + enumFields.length > 0 ? (
        <dl className='grid gap-2 sm:grid-cols-2'>
          {numberFields.map(([field, definition]) => (
            <div
              key={field}
              className='flex items-baseline justify-between gap-3'
            >
              <dt className='text-sm'>
                {taskPriceLabel(definition.description, field, i18n.language)}
              </dt>
              <dd className='text-muted-foreground text-xs'>
                {taskUsageUnitLabel(
                  definition,
                  i18n.language,
                  t(getTaskUsageQuantityUnitLabelKey(definition.unit))
                )}
              </dd>
            </div>
          ))}
          {enumFields.map(([field, definition]) => (
            <div
              key={field}
              className='flex items-baseline justify-between gap-3'
            >
              <dt className='text-sm'>
                <code>{field}</code>
              </dt>
              <dd className='text-muted-foreground text-right text-xs'>
                {(definition.enum ?? []).join(', ')}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

function AutoGroupChain(props: { model: PricingModel; autoGroups: string[] }) {
  const { t } = useTranslation()
  const modelEnableGroups = Array.isArray(props.model.enable_groups)
    ? props.model.enable_groups
    : []
  const autoChain = props.autoGroups.filter((g) =>
    modelEnableGroups.includes(g)
  )

  if (autoChain.length === 0) return null

  return (
    <div className='text-muted-foreground mb-3 flex flex-wrap items-center gap-1 text-xs'>
      <span className='font-medium'>{t('Auto Group Chain')}</span>
      <span className='text-muted-foreground/40'>→</span>
      {autoChain.map((g, idx) => (
        <span key={g} className='flex items-center gap-1'>
          <GroupBadge group={g} size='sm' />
          {idx < autoChain.length - 1 && (
            <span className='text-muted-foreground/40'>→</span>
          )}
        </span>
      ))}
    </div>
  )
}

type DynamicPriceOptions = Parameters<typeof getDynamicPriceEntries>[1]
type DynamicPricingTier = ReturnType<typeof getDynamicPricingTiers>[number]
type DynamicFormattedPricesByTier = Map<DynamicPricingTier, Map<string, string>>

function getDynamicPriceFields(
  tiers: DynamicPricingTier[],
  options: DynamicPriceOptions
) {
  return [
    ...new Map(
      tiers
        .flatMap((tier) => getDynamicPriceEntries(tier, options))
        .map((entry) => [entry.field, entry])
    ).values(),
  ]
}

function getDynamicFormattedPricesByTier(
  tiers: DynamicPricingTier[],
  options: DynamicPriceOptions
): DynamicFormattedPricesByTier {
  return new Map(
    tiers.map((tier) => [
      tier,
      new Map(
        getDynamicPriceEntries(tier, options).map((entry) => [
          entry.field,
          entry.formatted,
        ])
      ),
    ])
  )
}

// ----------------------------------------------------------------------------
// Group pricing table
// ----------------------------------------------------------------------------

type GroupPricingSectionProps = {
  model: PricingModel
  groupRatio: Record<string, number>
  usableGroup: Record<string, { desc: string; ratio: number }>
  autoGroups: string[]
  priceRate: number
  usdExchangeRate: number
  tokenUnit: TokenUnit
  showRechargePrice?: boolean
  selectedGroup?: string
  compact?: boolean
}

// Plugin keys cannot start with an underscore, so this tab value is free.
const ORDINARY_PRICING_TAB = '__model__'

export function GroupPricingSection(props: GroupPricingSectionProps) {
  const { t } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)
  const variants = props.model.billing_plugin_variants
  if (!variants?.length) {
    return <ProviderGroupPricingSection {...props} />
  }
  const ordinary = props.model.ordinary_pricing
  return (
    <section>
      <SectionTitle>
        {t(props.selectedGroup ? 'Channel pricing' : 'Pricing by Group')}
      </SectionTitle>
      <Tabs
        key={props.model.model_name}
        defaultValue={ordinary ? ORDINARY_PRICING_TAB : variants[0].plugin_key}
      >
        <TabsList
          aria-label={t('Provider')}
          className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'
        >
          {ordinary && (
            <TabsTrigger value={ORDINARY_PRICING_TAB}>
              {t('Default price')}
            </TabsTrigger>
          )}
          {variants.map((variant) => (
            <TabsTrigger
              key={variant.plugin_key}
              value={variant.plugin_key}
              className='max-w-full min-w-0'
            >
              <PluginIcon
                plugin={{
                  key: variant.plugin_key,
                  name: variant.plugin_name,
                  icon: variant.icon,
                }}
                size={16}
              />
              <span className='truncate' title={variant.plugin_name}>
                {variant.plugin_name}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {ordinary && (
          <TabsContent value={ORDINARY_PRICING_TAB}>
            <ProviderGroupPricingSection
              {...props}
              model={withOrdinaryPricing(props.model)}
              hideTitle
            />
          </TabsContent>
        )}
        {variants.map((variant) => (
          <TabsContent key={variant.plugin_key} value={variant.plugin_key}>
            {variant.billing_expr || variant.billing_mode === 'ratio' ? (
              <ProviderGroupPricingSection
                {...props}
                model={withPluginPricing(props.model, variant)}
                hideTitle
              />
            ) : (
              <UnconfiguredTaskPricingNotice
                model={withPluginPricing(props.model, variant)}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  )
}

function ProviderGroupPricingSection(
  props: GroupPricingSectionProps & { hideTitle?: boolean }
) {
  const { t, i18n } = useTranslation()
  const showRechargePrice = props.showRechargePrice ?? false

  const availableGroups = useMemo(
    () =>
      getAvailableGroups(props.model, props.usableGroup || {}).filter(
        (group) => !props.selectedGroup || group === props.selectedGroup
      ),
    [props.model, props.usableGroup, props.selectedGroup]
  )

  const isTokenBased = isTokenBasedModel(props.model)
  const tokenUnitLabel = props.tokenUnit === 'K' ? '1K' : '1M'

  const extraPriceTypes = useMemo(() => {
    const types: { label: string; type: PriceType }[] = []
    if (props.model.cache_ratio != null) {
      types.push({ label: t('Cache'), type: 'cache' })
    }
    if (props.model.create_cache_ratio != null) {
      types.push({ label: t('Cache Write'), type: 'create_cache' })
    }
    if (props.model.image_ratio != null) {
      types.push({ label: t('Image'), type: 'image' })
    }
    if (props.model.audio_ratio != null) {
      types.push({ label: t('Audio In'), type: 'audio_input' })
    }
    if (
      props.model.audio_ratio != null &&
      props.model.audio_completion_ratio != null
    ) {
      types.push({ label: t('Audio Out'), type: 'audio_output' })
    }
    return types
  }, [props.model, t])

  if (availableGroups.length === 0) {
    return (
      <section>
        {!props.hideTitle && (
          <SectionTitle>
            {t(props.selectedGroup ? 'Channel pricing' : 'Pricing by Group')}
          </SectionTitle>
        )}
        <AutoGroupChain model={props.model} autoGroups={props.autoGroups} />
        <p className='text-muted-foreground text-sm'>
          {t(
            'This model is not available in any group, or no group pricing information is configured.'
          )}
        </p>
      </section>
    )
  }

  const thClass = cn(
    'text-muted-foreground py-2 text-xs font-medium whitespace-normal break-words',
    !props.model.billing_usage_schema && 'tracking-wider uppercase'
  )

  if (isDynamicPricingModel(props.model)) {
    const dynamicTiers = props.model.billing_usage_schema
      ? getTaskPricingDisplayTiers(
          props.model.billing_expr,
          props.model.billing_usage_schema
        )
      : getDynamicPricingTiers(props.model)
    const hasRequestPrice = dynamicTiers.some(
      (tier) => !('unitPrices' in tier) && tier.billingUnit === 'request'
    )

    if (dynamicTiers.length === 0) {
      return (
        <section>
          {!props.hideTitle && (
            <SectionTitle>
              {t(props.selectedGroup ? 'Channel pricing' : 'Pricing by Group')}
            </SectionTitle>
          )}
          <AutoGroupChain model={props.model} autoGroups={props.autoGroups} />
          <div className='rounded-lg border border-amber-200/70 bg-amber-50/70 p-3 dark:border-amber-500/20 dark:bg-amber-500/10'>
            <div className='text-sm font-medium text-amber-800 dark:text-amber-200'>
              {t('Special billing expression')}
            </div>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t(
                pricingDisplayFallbackKey(
                  props.model.billing_expr || '',
                  props.model.billing_usage_schema
                )
              )}
            </p>
            <div className='mt-3'>
              <div className='text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase'>
                {t('Raw expression')}
              </div>
              <code className='text-muted-foreground bg-background/80 block max-h-28 overflow-auto rounded-md border px-2 py-1.5 font-mono text-xs break-all'>
                {props.model.billing_expr}
              </code>
            </div>
          </div>
        </section>
      )
    }

    const usageExampleRows = evaluateTaskUsageExamples(
      props.model.billing_expr,
      props.model.billing_usage_schema,
      props.model.billing_usage_examples
    )
    const priceFields = getDynamicPriceFields(dynamicTiers, {
      tokenUnit: props.tokenUnit,
      showRechargePrice,
      priceRate: props.priceRate,
      usdExchangeRate: props.usdExchangeRate,
      groupRatioMultiplier: 1,
      usageSchema: props.model.billing_usage_schema,
    })
    const formattedPricesByGroup = new Map(
      availableGroups.map((group) => {
        const ratio = getConfiguredGroupRatio(props.groupRatio, group)
        return [
          group,
          getDynamicFormattedPricesByTier(dynamicTiers, {
            tokenUnit: props.tokenUnit,
            showRechargePrice,
            priceRate: props.priceRate,
            usdExchangeRate: props.usdExchangeRate,
            groupRatioMultiplier: ratio,
            usageSchema: props.model.billing_usage_schema,
          }),
        ] as const
      })
    )

    return (
      <section>
        {!props.hideTitle && (
          <SectionTitle>
            {t(props.selectedGroup ? 'Channel pricing' : 'Pricing by Group')}
          </SectionTitle>
        )}
        <AutoGroupChain model={props.model} autoGroups={props.autoGroups} />
        <div className='space-y-3'>
          {availableGroups.map((group) => {
            const ratio = getConfiguredGroupRatio(props.groupRatio, group)
            const formattedPricesByTier =
              formattedPricesByGroup.get(group) ??
              new Map<DynamicPricingTier, Map<string, string>>()

            return (
              <div key={group} className='overflow-hidden rounded-lg border'>
                <div className='bg-muted/20 flex items-center justify-between gap-3 border-b px-3 py-2'>
                  <GroupBadge group={group} size='sm' />
                  {!props.compact && (
                    <span className='text-muted-foreground font-mono text-xs'>
                      {ratio}x
                    </span>
                  )}
                </div>
                <StaticDataTable
                  className='rounded-none border-0'
                  tableClassName='text-sm'
                  headerRowClassName='hover:bg-transparent'
                  data={dynamicTiers}
                  getRowKey={(tier, tierIndex) =>
                    `${group}-${tier.label}-${tierIndex}`
                  }
                  columns={[
                    ...(hasSimpleTaskPricing(props.model)
                      ? []
                      : [
                          {
                            id: 'tier',
                            header: props.model.billing_usage_schema
                              ? t('Applicable conditions')
                              : t('Tier'),
                            className: thClass,
                            cellClassName:
                              'text-muted-foreground py-2.5 whitespace-normal break-words',
                            cell: (tier: DynamicPricingTier) => {
                              if ('unitPrices' in tier) {
                                return (
                                  taskTierConditions(
                                    tier as ParsedTaskTier,
                                    props.model.billing_usage_schema,
                                    i18n.language,
                                    t
                                  ) ||
                                  t(
                                    dynamicTiers.length > 1
                                      ? 'Other cases'
                                      : 'All requests'
                                  )
                                )
                              }
                              if (tier.conditionText) {
                                return `${tier.label}: ${formatBillingCondition(tier.conditionText, t, i18n.language) ?? tier.conditionText}`
                              }
                              const condition = tier.conditions
                                .map(
                                  (item) =>
                                    `${item.var} ${item.op} ${item.value}`
                                )
                                .join(' && ')
                              const description = condition
                                ? (formatBillingCondition(
                                    condition,
                                    t,
                                    i18n.language
                                  ) ?? condition)
                                : t(
                                    dynamicTiers.length > 1
                                      ? 'Other cases'
                                      : 'All requests'
                                  )
                              return `${tier.label || t('Default')}: ${description}`
                            },
                          },
                        ]),
                    ...priceFields.map((fieldEntry) => {
                      const unitLabelKey =
                        getDynamicPriceUnitLabelKey(fieldEntry)
                      let unitLabel = taskUsageUnitLabel(
                        fieldEntry,
                        i18n.language,
                        unitLabelKey ? t(unitLabelKey) : ''
                      )
                      if (!unitLabel && hasRequestPrice) {
                        unitLabel = t('{{unit}} tokens', {
                          unit: tokenUnitLabel,
                        })
                      }
                      const fieldLabel =
                        fieldEntry.labelKind === 'schema' ? (
                          <DynamicPriceEntryLabel entry={fieldEntry} />
                        ) : (
                          t(fieldEntry.shortLabel)
                        )
                      return {
                        id: fieldEntry.field,
                        header: unitLabel ? (
                          <>
                            {fieldLabel}
                            {` / ${unitLabel}`}
                          </>
                        ) : (
                          fieldLabel
                        ),
                        className: `${thClass} text-right`,
                        cellClassName: 'py-2.5 text-right font-mono',
                        cell: (tier: (typeof dynamicTiers)[number]) =>
                          formattedPricesByTier
                            .get(tier)
                            ?.get(fieldEntry.field) ?? '-',
                      }
                    }),
                  ]}
                />
                {usageExampleRows.length > 0 ? (
                  <div className='border-t'>
                    <div className='text-muted-foreground px-3 pt-2 text-[10px] font-medium tracking-wider uppercase'>
                      {t('Price examples')}
                    </div>
                    <StaticDataTable
                      className='rounded-none border-0'
                      tableClassName='text-sm'
                      headerRowClassName='hover:bg-transparent'
                      data={usageExampleRows}
                      getRowKey={(row) => `${group}-${row.label}`}
                      columns={[
                        {
                          id: 'spec',
                          header: t('Spec'),
                          className: thClass,
                          cellClassName: 'text-muted-foreground py-2.5',
                          cell: (row) => row.label,
                        },
                        {
                          id: 'price',
                          header: t('Example price'),
                          className: `${thClass} text-right`,
                          cellClassName: 'py-2.5 text-right font-mono',
                          cell: (row) =>
                            `≈ ${formatTaskUsageUnitPrice(row.total, {
                              tokenUnit: props.tokenUnit,
                              showRechargePrice,
                              priceRate: props.priceRate,
                              usdExchangeRate: props.usdExchangeRate,
                              groupRatioMultiplier: ratio,
                            })}`,
                        },
                      ]}
                    />
                    <p className='text-muted-foreground/40 px-3 pb-2 text-[10px]'>
                      {t('Approximate prices for common specs.')}
                    </p>
                  </div>
                ) : null}
              </div>
            )
          })}
          <p className='text-muted-foreground/40 mt-1.5 text-[10px]'>
            {dynamicTiers.some(
              (tier) => 'unitPrices' in tier || tier.billingUnit === 'request'
            )
              ? t('Prices shown per usage unit')
              : t('Prices shown per {{unit}} tokens', { unit: tokenUnitLabel })}
          </p>
          {hasDynamicRequestRules(props.model) && (
            <DynamicPricingBreakdown
              billingExpr={props.model.billing_expr}
              usageSchema={props.model.billing_usage_schema}
              compact
              hideTierPrices
            />
          )}
        </div>
      </section>
    )
  }

  if (isUnconfiguredTaskUsageModel(props.model)) {
    return (
      <section>
        {!props.hideTitle && (
          <SectionTitle>
            {t(props.selectedGroup ? 'Channel pricing' : 'Pricing by Group')}
          </SectionTitle>
        )}
        <AutoGroupChain model={props.model} autoGroups={props.autoGroups} />
        <UnconfiguredTaskPricingNotice model={props.model} />
      </section>
    )
  }

  if (
    !Number.isFinite(
      isTokenBased ? props.model.model_ratio : props.model.model_price
    )
  ) {
    return <p className='text-muted-foreground text-sm'>{t('Unset price')}</p>
  }

  const renderGroupPrice = (group: string, type: PriceType) =>
    formatGroupPrice(
      props.model,
      group,
      type,
      props.tokenUnit,
      showRechargePrice,
      props.priceRate,
      props.usdExchangeRate,
      props.groupRatio
    )
  const renderFixedGroupPrice = (group: string) =>
    formatFixedPrice(
      props.model,
      group,
      showRechargePrice,
      props.priceRate,
      props.usdExchangeRate,
      props.groupRatio
    )

  return (
    <section>
      {!props.hideTitle && (
        <SectionTitle>
          {t(props.selectedGroup ? 'Channel pricing' : 'Pricing by Group')}
        </SectionTitle>
      )}
      <AutoGroupChain model={props.model} autoGroups={props.autoGroups} />
      <StaticDataTable
        className={cn(
          'rounded-none border-0',
          !props.compact && '-mx-4 sm:mx-0'
        )}
        tableClassName='text-sm'
        headerRowClassName='hover:bg-transparent'
        data={availableGroups}
        getRowKey={(group) => group}
        columns={[
          {
            id: 'group',
            header: t('Group'),
            className: thClass,
            cellClassName: 'py-2.5',
            cell: (group) => <GroupBadge group={group} size='sm' />,
          },
          ...(!props.compact
            ? [
                {
                  id: 'ratio',
                  header: t('Ratio'),
                  className: thClass,
                  cellClassName: 'text-muted-foreground py-2.5 font-mono',
                  cell: (group: string) =>
                    `${getConfiguredGroupRatio(props.groupRatio, group)}x`,
                },
              ]
            : []),
          ...(isTokenBased
            ? [
                {
                  id: 'input',
                  header: t('Input'),
                  className: `${thClass} text-right`,
                  cellClassName: 'py-2.5 text-right font-mono',
                  cell: (group: string) => renderGroupPrice(group, 'input'),
                },
                {
                  id: 'output',
                  header: t('Output'),
                  className: `${thClass} text-right`,
                  cellClassName: 'py-2.5 text-right font-mono',
                  cell: (group: string) => renderGroupPrice(group, 'output'),
                },
                ...extraPriceTypes.map((ep) => ({
                  id: ep.type,
                  header: ep.label,
                  className: `${thClass} text-right`,
                  cellClassName: 'py-2.5 text-right font-mono',
                  cell: (group: string) => renderGroupPrice(group, ep.type),
                })),
              ]
            : [
                {
                  id: 'price',
                  header: t('Price'),
                  className: `${thClass} text-right`,
                  cellClassName: 'py-2.5 text-right font-mono',
                  cell: renderFixedGroupPrice,
                },
              ]),
        ]}
      />
      <div className={cn(!props.compact && '-mx-4 sm:mx-0')}>
        <p className='text-muted-foreground/40 mt-1.5 px-4 text-[10px] sm:px-0'>
          {isTokenBased
            ? t('Prices shown per {{unit}} tokens', { unit: tokenUnitLabel })
            : t('Price per request')}
        </p>
      </div>
    </section>
  )
}
