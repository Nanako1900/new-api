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
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import type { ComponentProps } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { usePricingPreferencesStore } from '@/stores/pricing-preferences-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { MeowPricingCatalog } from '../components/meow/meow-pricing-catalog'
import type { PricingData, PricingModel, PricingReference } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

const LAST_HOUR = 1_800_000_000
const OPUS_EXPRESSION =
  'tier("standard", p * 4 + cr * 0.2 + cc * 5 + cc1h * 8 + c * 20)'
const REFERENCE: PricingReference = {
  source_url:
    'https://basellm.github.io/llm-metadata/api/newapi/ratio_config-v1-base.json',
  currency: 'USD',
  usd_to_cny_rate: 7.3,
  updated_at: LAST_HOUR,
  stale: false,
  models: {
    'claude-sonnet': {
      billing_mode: 'tiered_expr',
      billing_expr: OPUS_EXPRESSION,
    },
  },
}

const SONNET: PricingModel = {
  id: 1,
  model_name: 'claude-sonnet',
  quota_type: 0,
  model_ratio: 1.5,
  completion_ratio: 5,
  cache_ratio: 0.1,
  enable_groups: ['official', 'kiro'],
}

const PRICING: PricingData = {
  success: true,
  data: [SONNET],
  vendors: [],
  group_ratio: { official: 1.5, kiro: 0.9 },
  // The endpoint sends group → description strings.
  usable_group: {
    official: 'Official',
    kiro: 'Kiro',
  } as unknown as PricingData['usable_group'],
  supported_endpoint: {},
  auto_groups: [],
}

/** Serves the page requests; `perf` maps group → success rate, or fails. */
function mockApi(
  options: {
    pricing?: PricingData | 'fail' | 'fail-once'
    perf?: Record<string, number> | 'fail'
    ttft?: Record<string, number | undefined>
    reference?: PricingReference | 'fail'
  } = {}
) {
  let pricingCalls = 0
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === '/api/pricing') {
      pricingCalls += 1
      if (options.pricing === 'fail') throw new Error('pricing down')
      if (options.pricing === 'fail-once' && pricingCalls === 1) {
        throw new Error('pricing down')
      }
      if (options.pricing === 'fail-once') return { data: PRICING }
      return { data: options.pricing ?? PRICING }
    }
    if (url === '/api/pricing/reference') {
      if (options.reference === 'fail') {
        throw Object.assign(new Error('reference down'), {
          response: { status: 500 },
        })
      }
      return {
        data: {
          success: true,
          data: options.reference ?? { ...REFERENCE, models: {} },
        },
      }
    }
    if (url === '/api/perf-metrics') {
      if (options.perf === 'fail') {
        throw Object.assign(new Error('metrics down'), {
          response: { status: 500 },
        })
      }
      const groups = Object.entries(options.perf ?? {}).map(
        ([group, rate]) => ({
          group,
          success_rate: rate,
          avg_latency_ms: 1300,
          avg_tps: 74,
          avg_ttft_ms: options.ttft ? options.ttft[group] : 400,
          series: [],
        })
      )
      return {
        data: {
          success: true,
          data: {
            model_name: (config?.params as { model?: string } | undefined)
              ?.model,
            window_end: LAST_HOUR,
            groups,
          },
        },
      }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

function renderCatalog(
  status = { price: 1, usd_exchange_rate: 1 },
  onInternalServerError = vi.fn(),
  props: ComponentProps<typeof MeowPricingCatalog> = {}
) {
  const client = createAppQueryClient(onInternalServerError)
  client.setQueryData(['status'], status)
  render(
    <QueryClientProvider client={client}>
      <MeowPricingCatalog {...props} />
    </QueryClientProvider>
  )
  return client
}

async function sonnetRow(tableName: string) {
  const table = await screen.findByRole('table', { name: tableName })
  return within(table).getByRole('row', { name: /claude-sonnet/ })
}

beforeEach(() => {
  usePricingPreferencesStore.setState({ group: undefined })
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

afterEach(() => {
  usePricingPreferencesStore.setState({ group: undefined })
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  vi.restoreAllMocks()
})

describe('meow pricing catalog', () => {
  it('keeps the styled channel selection synchronized with keyboard navigation', async () => {
    const user = userEvent.setup()
    mockApi()
    renderCatalog()
    await sonnetRow('Models · Official')
    const official = screen.getByRole('button', { name: 'official' })
    const kiro = screen.getByRole('button', { name: 'kiro' })
    expect(official).toHaveAttribute('aria-pressed', 'true')
    expect(official).toHaveAttribute('data-checked', 'true')

    await user.click(official)
    await user.keyboard('{ArrowRight}{Enter}')

    expect(await sonnetRow('Models · Kiro')).toBeInTheDocument()
    expect(kiro).toHaveAttribute('aria-pressed', 'true')
    expect(kiro).toHaveAttribute('data-checked', 'true')
    expect(official).toHaveAttribute('data-checked', 'false')
  })

  it('shows model counts without prominent coefficients in mobile channel options with long names', async () => {
    const previousWidth = window.innerWidth
    const pointerCapture = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'setPointerCapture'
    )
    // jsdom does not implement the pointer capture used by the drawer.
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    })
    try {
      const user = userEvent.setup()
      const longGroup =
        'CC Max with a very long channel name for regional access'
      mockApi({
        pricing: {
          ...PRICING,
          data: [{ ...SONNET, enable_groups: ['official', longGroup] }],
          group_ratio: { official: 1.5, [longGroup]: 0.9 },
          usable_group: {
            official: { desc: 'Official', ratio: 1.5 },
            [longGroup]: { desc: 'Long channel', ratio: 0.9 },
          },
        },
      })
      renderCatalog()
      await sonnetRow('Models · Official')
      await user.click(screen.getByRole('combobox', { name: 'official' }))
      const dialog = await screen.findByRole('dialog', { name: 'Choose Group' })
      const official = within(dialog).getByRole('button', { name: /official/ })
      const kiro = within(dialog).getByRole('button', {
        name: new RegExp(longGroup),
      })
      expect(official).toHaveAttribute('aria-pressed', 'true')
      expect(official).toHaveAttribute('data-checked', 'true')
      expect(kiro).toHaveTextContent('1Models')
      expect(kiro).not.toHaveTextContent('×')
      expect(kiro).toHaveAttribute('aria-pressed', 'false')

      await user.click(kiro)

      expect(await sonnetRow('Models · Long channel')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: longGroup })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: previousWidth,
      })
      if (pointerCapture) {
        Object.defineProperty(
          HTMLElement.prototype,
          'setPointerCapture',
          pointerCapture
        )
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
      }
    }
  })

  it('wraps desktop channel choices while preserving long names, counts and keyboard selection', async () => {
    const user = userEvent.setup()
    const longGroup = 'CC Max with a very long channel name for regional access'
    mockApi({
      pricing: {
        ...PRICING,
        data: [{ ...SONNET, enable_groups: ['official', longGroup] }],
        group_ratio: { official: 1.5, [longGroup]: 1.3 },
        usable_group: {
          official: { desc: 'Official', ratio: 1.5 },
          [longGroup]: { desc: 'Long channel', ratio: 1.3 },
        },
      },
    })
    renderCatalog()
    await sonnetRow('Models · Official')
    const choices = screen.getByRole('group', { name: 'Choose a channel' })
    expect(choices).toHaveClass('flex-wrap')
    const option = within(choices).getByRole('button', { name: longGroup })
    expect(option).toHaveClass('max-w-full', 'min-w-0', 'whitespace-normal')
    expect(option).toHaveTextContent('Models 1')
    expect(option).not.toHaveTextContent('Long channel')
    option.focus()
    await user.keyboard('{Enter}')
    expect(await sonnetRow('Models · Long channel')).toBeInTheDocument()
    expect(option).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows one channel at a time and remembers the selected channel', async () => {
    const user = userEvent.setup()
    const onGroupChange = vi.fn()
    mockApi()
    renderCatalog(undefined, undefined, { onGroupChange })

    expect(await sonnetRow('Models · Official')).toHaveTextContent('$4.5')
    expect(screen.getAllByRole('table')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'kiro' }))

    expect(await sonnetRow('Models · Kiro')).toHaveTextContent('$2.7')
    expect(
      screen.queryByRole('table', { name: 'Models · Official' })
    ).not.toBeInTheDocument()
    expect(usePricingPreferencesStore.getState().group).toBe('kiro')
    expect(onGroupChange).toHaveBeenCalledWith('kiro')
  })

  it.each([
    { group: undefined, remembered: 'kiro', expected: 'Kiro' },
    { group: 'official', remembered: 'kiro', expected: 'Official' },
    { group: 'hidden', remembered: 'kiro', expected: 'Kiro' },
    { group: 'hidden', remembered: 'removed', expected: 'Official' },
  ])(
    'resolves link group $group and remembered group $remembered to $expected',
    async (testCase) => {
      usePricingPreferencesStore.setState({ group: testCase.remembered })
      mockApi()
      renderCatalog(undefined, undefined, { group: testCase.group })
      expect(
        await sonnetRow(`Models · ${testCase.expected}`)
      ).toBeInTheDocument()
      expect(screen.getAllByRole('table')).toHaveLength(1)
    }
  )

  it('searches only the selected channel and fetches metrics only for its visible models', async () => {
    const user = userEvent.setup()
    mockApi({
      pricing: {
        ...PRICING,
        data: [
          SONNET,
          {
            ...SONNET,
            id: 2,
            model_name: 'gpt-example',
            enable_groups: ['official'],
          },
        ],
      },
    })
    renderCatalog(undefined, undefined, { group: 'kiro' })
    await sonnetRow('Models · Kiro')
    expect(api.get).not.toHaveBeenCalledWith(
      '/api/perf-metrics',
      expect.objectContaining({
        params: expect.objectContaining({ model: 'gpt-example' }),
      })
    )

    await user.type(
      screen.getByRole('searchbox', { name: 'Search models in this channel' }),
      'gpt'
    )
    expect(
      await screen.findByText('No matching models in this channel')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'gpt-example' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(await sonnetRow('Models · Kiro')).toBeInTheDocument()
  })

  it('includes different model families in the same selected channel', async () => {
    mockApi({
      pricing: {
        ...PRICING,
        data: [
          SONNET,
          { ...SONNET, id: 2, model_name: 'gpt-example' },
          { ...SONNET, id: 3, model_name: 'custom-model' },
        ],
      },
    })
    renderCatalog()
    const table = await screen.findByRole('table', {
      name: 'Models · Official',
    })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(
      within(table).getByRole('button', { name: 'custom-model' })
    ).toBeInTheDocument()
  })
  it('shows the actual CNY charge and matched reference savings without a recharge multiplier', async () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 1,
      },
    })
    mockApi({
      reference: REFERENCE,
      pricing: {
        ...PRICING,
        data: [
          {
            ...SONNET,
            enable_groups: ['CC Max'],
            billing_mode: 'tiered_expr',
            billing_expr:
              'tier("standard", p * 4 + cr * 0.2 + cc * 5 + cc1h * 8 + c * 20)',
          },
        ],
        group_ratio: { 'CC Max': 1.3 },
        usable_group: { 'CC Max': { desc: 'Claude channel', ratio: 1.3 } },
      },
    })
    renderCatalog({ price: 7.3, usd_exchange_rate: 1 })

    const cells = within(
      await sonnetRow('Models · Claude channel')
    ).getAllByRole('cell')
    expect(cells[1]).toHaveAccessibleName('Input')
    expect(cells[1]).toHaveTextContent('¥5.2')
    expect(
      await screen.findByText('About 82.19% below reference')
    ).toBeInTheDocument()
    expect(cells[2]).toHaveAccessibleName('Output')
    expect(cells[2]).toHaveTextContent('¥26')
    expect(cells[3]).toHaveAccessibleName('Cache Read')
    expect(cells[3]).toHaveTextContent('¥0.26')
    expect(within(cells[4]).getByText('24h status')).toHaveClass('md:sr-only')
    expect(
      within(cells[4]).getByLabelText('No monitoring data')
    ).toHaveTextContent('—')
    expect(
      screen.queryByRole('button', { name: 'Recharge' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Standard' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/official price/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('deletion')).not.toBeInTheDocument()
    expect(
      screen.getByText('Token prices: CNY / 1M tokens')
    ).toBeInTheDocument()
    act(() =>
      useSystemConfigStore
        .getState()
        .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
    )
    expect(cells[1]).toHaveTextContent('$5.2')
    expect(
      screen.queryByText('About 82.19% below reference')
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Token prices: USD / 1M tokens')
    ).toBeInTheDocument()
  })

  it.each([
    { term: 'ai * 0.08', label: 'Audio In', amount: '¥0.4' },
    { term: 'ao * 0.3', label: 'Audio Out', amount: '¥1.5' },
  ])(
    'shows Gemini Ultra token columns with a separate $label price in the popup',
    async ({ term, label, amount }) => {
      const user = userEvent.setup()
      useSystemConfigStore.getState().setConfig({
        currency: {
          ...DEFAULT_CURRENCY_CONFIG,
          quotaDisplayType: 'CNY',
          usdExchangeRate: 1,
        },
      })
      mockApi({
        pricing: {
          ...PRICING,
          data: [
            {
              ...SONNET,
              model_name: 'gemini-4-carbon',
              enable_groups: ['official', 'Gemini Ultra'],
              billing_mode: 'tiered_expr',
              billing_expr: `tier("standard", p * 0.08 + c * 0.4 + cr * 0.004 + ${term})`,
            },
          ],
          group_ratio: { official: 1, 'Gemini Ultra': 5 },
          usable_group: {
            official: { desc: 'Official', ratio: 1 },
            'Gemini Ultra': { desc: 'Gemini Ultra', ratio: 5 },
          },
        },
      })
      renderCatalog(undefined, undefined, { group: 'Gemini Ultra' })

      const table = await screen.findByRole('table', {
        name: 'Models · Gemini Ultra',
      })
      const row = within(table).getByRole('row', { name: /gemini-4-carbon/ })
      expect(
        within(row).getByRole('cell', { name: 'Input' })
      ).toHaveTextContent('¥0.4')
      expect(
        within(row).getByRole('cell', { name: 'Output' })
      ).toHaveTextContent('¥2')
      expect(
        within(row).getByRole('cell', { name: 'Cache Read' })
      ).toHaveTextContent('¥0.02')
      await user.click(
        within(row).getByRole('button', {
          name: 'Price details for gemini-4-carbon',
        })
      )
      const popup = await screen.findByRole('dialog', {
        name: 'Price details for gemini-4-carbon',
      })
      const headers = within(popup).getAllByRole('columnheader')
      const audioHeader = within(popup).getByRole('columnheader', {
        name: label,
      })
      expect(
        within(popup).getAllByRole('cell')[headers.indexOf(audioHeader)]
      ).toHaveTextContent(amount)
    }
  )

  it('hides tier details until its arrow opens complete selected-channel prices', async () => {
    await import('../components/model-details')
    const user = userEvent.setup()
    mockApi({
      pricing: {
        ...PRICING,
        data: [
          {
            ...SONNET,
            billing_mode: 'tiered_expr',
            billing_expr:
              'len <= 200000 ? tier("short", p * 1 + cr * 0.1 + cc * 1.25 + cc1h * 2 + c * 5) : tier("long", p * 2 + cr * 0.2 + cc * 2.5 + cc1h * 4 + c * 10)',
          },
        ],
      },
    })
    renderCatalog()
    const row = await sonnetRow('Models · Official')
    const cells = within(row).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('From $1.5')
    expect(cells[1]).not.toHaveTextContent('$3')
    expect(cells[2]).toHaveTextContent('From $7.5')
    expect(cells[2]).not.toHaveTextContent('$15')
    expect(row).not.toHaveTextContent(
      'Prices vary by usage tier and request conditions'
    )
    await user.click(
      within(row).getByRole('button', {
        name: 'Price details for claude-sonnet',
      })
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Price details for claude-sonnet',
    })
    expect(dialog).toHaveTextContent('short')
    expect(dialog).toHaveTextContent('long')
    expect(dialog).toHaveTextContent('Cache Write (5m)')
    expect(dialog).toHaveTextContent('Cache Write (1h)')
    expect(dialog).toHaveTextContent('200,000')
    expect(dialog).toHaveTextContent('$1.875')
    expect(dialog).toHaveTextContent('$6')
  }, 60_000)

  it('opens prices with the keyboard, closes on Escape, and restores focus to the arrow', async () => {
    const user = userEvent.setup()
    mockApi()
    renderCatalog()
    const row = await sonnetRow('Models · Official')
    const trigger = within(row).getByRole('button', {
      name: 'Price details for claude-sonnet',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    trigger.focus()
    await user.keyboard('{Enter}')
    const popup = await screen.findByRole('dialog', {
      name: 'Price details for claude-sonnet',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(popup).toHaveClass('overflow-y-auto', 'overscroll-contain')
    expect(popup).toHaveTextContent('$4.5')
    expect(popup).not.toHaveTextContent('1.5x')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    await screen.findByRole('dialog', {
      name: 'Price details for claude-sonnet',
    })
    await user.click(screen.getByRole('searchbox'))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it.each([
    { kind: 'flat token', model: {}, expected: '$4.5' },
    {
      kind: 'request',
      model: { quota_type: 1, model_price: 0.04 },
      expected: '$0.06',
    },
    {
      kind: 'task usage',
      model: {
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("base", u("seconds") * 0.2)',
        billing_usage_schema: { seconds: { type: 'number', unit: 'second' } },
      },
      expected: '$0.3',
    },
    {
      kind: 'plugin',
      model: {
        billing_plugin_variants: [
          {
            plugin_key: 'video',
            plugin_name: 'Video provider',
            billing_expr: 'tier("base", u("seconds") * 0.2)',
            billing_mode: 'tiered_expr',
            billing_usage_schema: {
              seconds: { type: 'number', unit: 'second' },
            },
          },
        ],
      },
      expected: 'Video provider',
    },
    {
      kind: 'unconfigured',
      model: {
        billing_usage_schema: { seconds: { type: 'number', unit: 'second' } },
      },
      expected:
        'This model is billed by usage, but the administrator has not configured its pricing yet.',
    },
    {
      kind: 'missing request price',
      model: { quota_type: 1 },
      expected: 'Unset price',
    },
  ] satisfies {
    kind: string
    model: Partial<PricingModel>
    expected: string
  }[])(
    'provides an arrow and a usable pricing popup for $kind models',
    async ({ model, expected }) => {
      const user = userEvent.setup()
      mockApi({ pricing: { ...PRICING, data: [{ ...SONNET, ...model }] } })
      renderCatalog()
      const row = await sonnetRow('Models · Official')
      await user.click(
        within(row).getByRole('button', {
          name: 'Price details for claude-sonnet',
        })
      )
      const popup = await screen.findByRole('dialog', {
        name: 'Price details for claude-sonnet',
      })
      expect(popup).toHaveTextContent(expected)
      if (
        model.billing_usage_schema?.seconds ||
        model.billing_plugin_variants?.length
      ) {
        expect(popup).toHaveTextContent('s')
      }
    }
  )

  it('shows source USD and converted CNY prices with the cached reference date and fixed rate', async () => {
    const user = userEvent.setup()
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 1,
      },
    })
    mockApi({
      reference: { ...REFERENCE, stale: true },
      pricing: {
        ...PRICING,
        data: [
          {
            ...SONNET,
            billing_mode: 'tiered_expr',
            billing_expr: OPUS_EXPRESSION,
          },
        ],
      },
    })
    renderCatalog()
    const row = await sonnetRow('Models · Official')
    await user.click(
      within(row).getByRole('button', {
        name: 'Price details for claude-sonnet',
      })
    )
    const popup = await screen.findByRole('dialog', {
      name: 'Price details for claude-sonnet',
    })
    expect(popup).toHaveTextContent('$4 · ¥29.2')
    // Focusing the source link would scroll a narrow popup past the actual prices.
    expect(popup).toHaveFocus()
    expect(popup).toHaveTextContent('1 USD = 7.3 CNY')
    expect(popup).toHaveTextContent('Reference updated:')
    expect(popup).toHaveTextContent(
      'Using the last cached reference; refresh is pending.'
    )
    expect(
      within(popup).getByRole('link', {
        name: 'Source: Basellm reference data',
      })
    ).toHaveAttribute('href', REFERENCE.source_url)
    expect(popup).toHaveTextContent('Savings use the smallest reduction')
  })

  it('shows explicit zero reference prices without inventing missing fields or a discount', async () => {
    const user = userEvent.setup()
    mockApi({
      reference: {
        ...REFERENCE,
        models: {
          'claude-sonnet': {
            billing_mode: 'tiered_expr',
            billing_expr: 'tier("base", p * 0 + c * 20)',
          },
        },
      },
    })
    renderCatalog()
    const row = await sonnetRow('Models · Official')
    await user.click(
      within(row).getByRole('button', {
        name: 'Price details for claude-sonnet',
      })
    )
    const popup = await screen.findByRole('dialog', {
      name: 'Price details for claude-sonnet',
    })
    const reference = within(popup).getByRole('region', {
      name: 'Reference prices',
    })
    expect(reference).toHaveTextContent('$0 · ¥0')
    expect(reference).not.toHaveTextContent('Cache Read')
    expect(reference).not.toHaveTextContent('below reference')
  })

  it('keeps request conditions in the popup with the selected-channel base prices', async () => {
    const user = userEvent.setup()
    mockApi({
      pricing: {
        ...PRICING,
        data: [
          {
            ...SONNET,
            billing_mode: 'tiered_expr',
            billing_expr:
              '(tier("base", p * 2 + c * 8)) * (param("speed") == "fast" ? 2 : 1)',
          },
        ],
      },
    })
    renderCatalog()
    const row = await sonnetRow('Models · Official')
    expect(row).toHaveTextContent('Dynamic Pricing')
    expect(row).not.toHaveTextContent('fast')
    await user.click(
      within(row).getByRole('button', {
        name: 'Price details for claude-sonnet',
      })
    )
    const popup = await screen.findByRole('dialog', {
      name: 'Price details for claude-sonnet',
    })
    expect(popup).toHaveTextContent('Conditional multipliers')
    expect(popup).toHaveTextContent('fast')
    expect(popup).toHaveTextContent('$3')
    expect(popup).toHaveTextContent('$12')
  })

  it('updates reference number formatting after switching all interface languages and handles invalid locales', async () => {
    const user = userEvent.setup()
    mockApi({
      reference: REFERENCE,
      pricing: {
        ...PRICING,
        data: [
          {
            ...SONNET,
            billing_mode: 'tiered_expr',
            billing_expr: OPUS_EXPRESSION,
          },
        ],
      },
    })
    renderCatalog()
    const row = await sonnetRow('Models · Official')
    await user.click(
      within(row).getByRole('button', {
        name: 'Price details for claude-sonnet',
      })
    )
    const popup = await screen.findByRole('dialog', {
      name: 'Price details for claude-sonnet',
    })
    const languages = [
      'zhCN',
      'zhTW',
      'en',
      'fr',
      'ja',
      'ru',
      'vi',
      'invalid_locale_!',
    ]
    try {
      for (const language of languages) {
        // Ensure i18next resolves to each interface code, even with a small test resource.
        i18next.addResource(
          language,
          'translation',
          'Reference prices',
          'Reference prices'
        )
        await act(() => i18next.changeLanguage(language))
        const decimal = ['fr', 'ru', 'vi'].includes(language) ? '29,2' : '29.2'
        expect(
          within(popup).getByRole('region', { name: 'Reference prices' })
        ).toHaveTextContent(decimal)
      }
    } finally {
      await act(() => i18next.changeLanguage('en'))
      for (const language of languages) {
        if (language !== 'en') {
          i18next.removeResourceBundle(language, 'translation')
        }
      }
      delete i18next.getResourceBundle('en', 'translation')['Reference prices']
    }
  })

  it('keeps the catalog and price popup usable without alerts when reference loading fails', async () => {
    const user = userEvent.setup()
    const toastError = vi.spyOn(toast, 'error')
    const onInternalServerError = vi.fn()
    mockApi({ reference: 'fail' })
    const client = renderCatalog(undefined, onInternalServerError)
    const row = await sonnetRow('Models · Official')
    await waitFor(() =>
      expect(client.getQueryState(['pricing-reference'])?.status).toBe('error')
    )
    expect(row).toHaveTextContent('$4.5')
    await user.click(
      within(row).getByRole('button', {
        name: 'Price details for claude-sonnet',
      })
    )
    expect(
      await screen.findByRole('dialog', {
        name: 'Price details for claude-sonnet',
      })
    ).toHaveTextContent(
      'No matching reference price is available. Channel prices remain valid.'
    )
    expect(toastError).not.toHaveBeenCalled()
    expect(onInternalServerError).not.toHaveBeenCalled()
  })

  it.each([
    { expression: 'tier("base", p * 4 + cr * 0 + c * 20)', cache: '$0' },
    { expression: 'tier("base", p * 4 + c * 20)', cache: '—' },
  ])(
    'keeps zero and missing expression cache prices distinct: $cache',
    async ({ expression, cache }) => {
      mockApi({
        pricing: {
          ...PRICING,
          data: [
            {
              ...SONNET,
              billing_mode: 'tiered_expr',
              billing_expr: expression,
            },
          ],
        },
      })
      renderCatalog()
      expect(
        within(await sonnetRow('Models · Official')).getAllByRole('cell')[3]
      ).toHaveTextContent(cache)
    }
  )

  it('scopes the shared token unit in a task-only channel while retaining task billing units', async () => {
    mockApi({
      pricing: {
        ...PRICING,
        data: [
          {
            ...SONNET,
            billing_mode: 'tiered_expr',
            billing_expr: 'tier("base", u("seconds") * 0.2)',
            billing_usage_schema: {
              seconds: { type: 'number', unit: 'second' },
            },
          },
        ],
      },
    })
    renderCatalog()
    const cells = within(await sonnetRow('Models · Official')).getAllByRole(
      'cell'
    )
    expect(cells[1]).toHaveAttribute('aria-colspan', '3')
    expect(cells[1]).toHaveTextContent('0.3/s')
    expect(cells).toHaveLength(4)
    expect(
      screen.getByText('Token prices: USD / 1M tokens')
    ).toBeInTheDocument()
    expect(screen.queryByText('USD / 1M tokens')).not.toBeInTheDocument()
  })

  it.each([
    {
      kind: 'arbitrary',
      model: { billing_mode: 'tiered_expr', billing_expr: 'p * c' },
      expected: 'Special billing expression',
    },
    {
      kind: 'mixed',
      model: {
        billing_mode: 'tiered_expr',
        billing_expr:
          'len < 1000 ? tier("request", fixed(0.01)) : tier("tokens", p * 2 + c * 8)',
      },
      expected: 'Token or per-call pricing',
    },
    {
      kind: 'audio-only',
      model: {
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("base", ai * 2 + ao * 8)',
      },
      expected: 'Dynamic Pricing',
    },
    {
      kind: 'missing input in an audio tier',
      model: {
        billing_mode: 'tiered_expr',
        billing_expr:
          'len <= 200000 ? tier("short", p * 1 + c * 5 + ai * 2) : tier("long", c * 10 + ai * 4)',
      },
      expected: 'Dynamic Pricing',
    },
    {
      kind: 'image-count multiplier on audio prices',
      model: {
        billing_mode: 'tiered_expr',
        billing_expr:
          'image_count * tier("base", p * 0.08 + c * 0.4 + ai * 0.08)',
      },
      expected: 'Dynamic Pricing',
    },
    {
      kind: 'audio-dependent token counts',
      model: {
        billing_mode: 'tiered_expr',
        billing_expr:
          'ai > 0 || ao > 0 ? tier("audio", max(len - ai, 0) * 0.2 + c * 0.4 + ai * 1 + ao * 4) : tier("text", p * 0.08 + c * 0.4)',
      },
      expected: 'Dynamic Pricing',
    },
    {
      kind: 'context-based input quantity with audio and cache',
      model: {
        billing_mode: 'tiered_expr',
        billing_expr:
          'tier("standard", max(len - ai, 0) * 0.08 + c * 0.4 + cr * 0.004 + ai * 0.08)',
      },
      expected: 'Dynamic Pricing',
    },
    {
      kind: 'mixed input quantity bases',
      model: {
        billing_mode: 'tiered_expr',
        billing_expr:
          'len < 2000 ? tier("short", p * 0.08 + c * 0.4 + cr * 0.004 + ai * 0.08) : tier("long", max(len - ai, 0) * 0.08 + c * 0.4 + cr * 0.004)',
      },
      expected: 'Dynamic Pricing',
    },
    {
      kind: 'unconfigured task',
      model: {
        billing_usage_schema: { seconds: { type: 'number', unit: 'second' } },
      },
      expected: 'Not configured',
    },
  ] satisfies {
    kind: string
    model: Partial<PricingModel>
    expected: string
  }[])(
    'retains the $kind pricing fallback instead of claiming token prices',
    async ({ model, expected }) => {
      mockApi({ pricing: { ...PRICING, data: [{ ...SONNET, ...model }] } })
      renderCatalog()
      const cells = within(await sonnetRow('Models · Official')).getAllByRole(
        'cell'
      )
      expect(cells[1]).toHaveAttribute('aria-colspan', '3')
      expect(cells[1]).toHaveTextContent(expected)
      expect(cells).toHaveLength(4)
    }
  )

  it('refreshes current-period token columns when the billing clock crosses a price boundary', async () => {
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-11-15T10:00:00Z'))
    mockApi({
      pricing: {
        ...PRICING,
        data: [
          {
            ...SONNET,
            billing_mode: 'tiered_expr',
            billing_expr:
              'hour("UTC") < 12 ? tier("morning", p * 2 + c * 8) : tier("afternoon", p * 4 + c * 16)',
          },
        ],
      },
    })
    renderCatalog()
    const row = await sonnetRow('Models · Official')
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('$3')
    expect(row).not.toHaveTextContent('Current period price')
    now.mockReturnValue(Date.parse('2026-11-15T13:00:00Z'))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('$6')
  })

  it('opens the details drawer when a model name is clicked', async () => {
    // The drawer loads lazily; warm its chunk so a cold module cache cannot
    // outlast the lookup below.
    await import('../components/model-details')
    const user = userEvent.setup()
    mockApi()
    renderCatalog()

    await user.click(
      within(await sonnetRow('Models · Official')).getByRole('button', {
        name: 'claude-sonnet',
      })
    )

    expect(
      await screen.findByRole('dialog', { name: 'claude-sonnet' })
    ).toBeInTheDocument()
  }, 60_000)

  it('opens details with the selected channel price and keeps base pricing collapsed', async () => {
    const user = userEvent.setup()
    mockApi()
    renderCatalog(undefined, undefined, { group: 'kiro' })
    await user.click(
      within(await sonnetRow('Models · Kiro')).getByRole('button', {
        name: 'claude-sonnet',
      })
    )

    const dialog = await screen.findByRole('dialog', { name: 'claude-sonnet' })
    const pricing = within(dialog).getByRole('region', {
      name: 'Channel pricing',
    })
    expect(pricing).toHaveTextContent('$2.7')
    expect(pricing).not.toHaveTextContent('$4.5')
    expect(
      within(pricing).getByRole('button', { name: 'Base pricing' })
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('preserves a zero channel multiplier in dynamic model details for all-group models', async () => {
    const user = userEvent.setup()
    mockApi({
      pricing: {
        ...PRICING,
        data: [
          {
            ...SONNET,
            enable_groups: ['all'],
            billing_mode: 'tiered_expr',
            billing_expr: 'tier("base", p * 2 + c * 8)',
          },
        ],
        group_ratio: { official: 1, free: 0 },
        usable_group: {
          official: { desc: 'Official', ratio: 1 },
          free: { desc: 'Free channel', ratio: 0 },
        },
      },
    })
    renderCatalog(undefined, undefined, { group: 'free' })
    await user.click(
      within(await sonnetRow('Models · Free channel')).getByRole('button', {
        name: 'claude-sonnet',
      })
    )
    const dialog = await screen.findByRole('dialog', { name: 'claude-sonnet' })
    const pricing = within(dialog).getByRole('region', {
      name: 'Channel pricing',
    })
    expect(pricing).toHaveTextContent('0x')
    expect(pricing).toHaveTextContent('$0')
    expect(pricing).not.toHaveTextContent('1x')
    expect(within(pricing).getAllByRole('table')).toHaveLength(1)
  })

  it('shows each channel the success rate measured for its group', async () => {
    const user = userEvent.setup()
    mockApi({ perf: { official: 99.95, kiro: 97.8 } })
    renderCatalog()

    const official = await sonnetRow('Models · Official')
    await waitFor(() => expect(official).toHaveTextContent('99.95%'))
    await user.click(screen.getByRole('button', { name: 'kiro' }))
    expect(await sonnetRow('Models · Kiro')).toHaveTextContent('97.80%')
  })

  it('shows the selected channel TTFT from the backend instead of total request latency', async () => {
    const user = userEvent.setup()
    mockApi({
      perf: { official: 99.95, kiro: 97.8 },
      ttft: { official: 400, kiro: 2450 },
    })
    renderCatalog()

    const official = await sonnetRow('Models · Official')
    await waitFor(() => expect(official).toHaveTextContent('400ms · 74.0 t/s'))
    expect(official).not.toHaveTextContent('1.30s')
    expect(
      screen.getByRole('columnheader', {
        name: 'Time to first token · Throughput short',
      })
    ).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/api/perf-metrics', {
      params: { model: 'claude-sonnet', hours: 24 },
    })

    await user.click(screen.getByRole('button', { name: 'kiro' }))

    const kiro = await sonnetRow('Models · Kiro')
    expect(kiro).toHaveTextContent('2.45s · 74.0 t/s')
    expect(kiro).not.toHaveTextContent('400ms')
  })

  it.each([0, undefined])(
    'shows no first-token measurement when the backend TTFT is %s without using total latency',
    async (ttft) => {
      mockApi({ perf: { official: 99.95 }, ttft: { official: ttft } })
      renderCatalog()

      const official = await sonnetRow('Models · Official')
      await waitFor(() => expect(official).toHaveTextContent('— · 74.0 t/s'))
      expect(official).not.toHaveTextContent('1.30s')
    }
  )

  it('keeps prices, stays on the page and stays quiet when the metrics request fails', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const onInternalServerError = vi.fn()
    mockApi({ perf: 'fail' })
    const client = renderCatalog(
      { price: 1, usd_exchange_rate: 1 },
      onInternalServerError
    )

    const row = await sonnetRow('Models · Official')
    await waitFor(() =>
      expect(
        client.getQueryState(['perf-metrics', 'claude-sonnet'])?.status
      ).toBe('error')
    )
    expect(onInternalServerError).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    const cells = within(row).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('$4.5')
    expect(cells[4]).toHaveTextContent('—')
    expect(cells[5]).toHaveTextContent('—')
  })

  it('shows the empty state when no channel has models', async () => {
    mockApi({ pricing: { ...PRICING, data: [] } })
    renderCatalog()

    expect(await screen.findByText('No models available')).toBeInTheDocument()
  })

  it('shows the error state with a retry button when pricing fails to load', async () => {
    mockApi({ pricing: 'fail' })
    renderCatalog()

    expect(await screen.findByText('Failed to load models')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('loads the price list after a retry when pricing failed once', async () => {
    const user = userEvent.setup()
    mockApi({ pricing: 'fail-once' })
    renderCatalog()

    expect(await screen.findByText('Failed to load models')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await sonnetRow('Models · Official')).toBeInTheDocument()
  })
})
