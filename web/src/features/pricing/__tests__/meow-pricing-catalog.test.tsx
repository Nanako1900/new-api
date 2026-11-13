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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { usePricingPreferencesStore } from '@/stores/pricing-preferences-store'

import { MeowPricingCatalog } from '../components/meow/meow-pricing-catalog'
import type { PricingData, PricingModel } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

const LAST_HOUR = 1_800_000_000

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
          avg_ttft_ms: 400,
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
})

afterEach(() => {
  usePricingPreferencesStore.setState({ group: undefined })
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

  it('shows model counts and separate multipliers in the mobile channel options', async () => {
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
      mockApi()
      renderCatalog()
      await sonnetRow('Models · Official')
      await user.click(screen.getByRole('combobox', { name: 'official' }))
      const dialog = await screen.findByRole('dialog', { name: 'Choose Group' })
      const official = within(dialog).getByRole('button', { name: /official/ })
      const kiro = within(dialog).getByRole('button', { name: /kiro/ })
      expect(official).toHaveAttribute('aria-pressed', 'true')
      expect(official).toHaveAttribute('data-checked', 'true')
      expect(kiro).toHaveTextContent('1Models')
      expect(kiro).toHaveTextContent('×0.9')
      expect(kiro).toHaveAttribute('aria-pressed', 'false')

      await user.click(kiro)

      expect(await sonnetRow('Models · Kiro')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'kiro' })).toHaveAttribute(
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
  it('hides the price mode switch when recharge and exchange rates match', async () => {
    mockApi()
    renderCatalog({ price: 1, usd_exchange_rate: 1 })

    await sonnetRow('Models · Official')

    expect(
      screen.queryByRole('button', { name: 'Recharge' })
    ).not.toBeInTheDocument()
  })

  it('switches to recharge prices when top-ups are discounted', async () => {
    const user = userEvent.setup()
    mockApi()
    renderCatalog({ price: 4, usd_exchange_rate: 8 })
    expect(await sonnetRow('Models · Official')).toHaveTextContent('$4.5')

    await user.click(screen.getByRole('button', { name: 'Recharge' }))

    expect(await sonnetRow('Models · Official')).toHaveTextContent('$2.25')
  })

  it('explains channel prices as the official price times the channel multiplier', async () => {
    mockApi()
    renderCatalog()

    await sonnetRow('Models · Official')

    expect(
      screen.getByText('Channel multiplier').closest('p')
    ).toHaveTextContent('Official price × Channel multiplier = Our price')
  })

  it('compares recharge prices with the official price when recharge is shown', async () => {
    const user = userEvent.setup()
    mockApi()
    renderCatalog({ price: 4, usd_exchange_rate: 8 })
    await sonnetRow('Models · Official')
    expect(screen.getByText('1.5× official price')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Recharge' }))

    expect(
      await screen.findByText('25% off official price')
    ).toBeInTheDocument()
    expect(
      within(await sonnetRow('Models · Official')).getAllByRole('deletion')[0]
    ).toHaveTextContent('Official price $3')
    expect(
      screen.getByText('Channel multiplier').closest('p')
    ).toHaveTextContent(
      'Official price × Channel multiplier × Recharge discount = Our price'
    )
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
