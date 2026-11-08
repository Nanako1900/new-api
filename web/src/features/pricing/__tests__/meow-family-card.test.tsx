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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PerformanceGroup } from '@/features/performance-metrics/types'

import { MeowFamilyCard } from '../components/meow/meow-family-card'
import type { MeowPriceOptions } from '../components/meow/meow-model-row'
import {
  buildMeowCatalog,
  type MeowChannelPerf,
  type MeowFamily,
  type MeowFamilyId,
} from '../lib/meow-catalog'
import type { PricingModel } from '../types'

const GROUP_RATIO = { official: 1.5, kiro: 0.9 }
const PRICES: MeowPriceOptions = {
  showRechargePrice: false,
  priceRate: 1,
  usdExchangeRate: 1,
  groupRatio: GROUP_RATIO,
}
const LAST_HOUR = 1_800_000_000
const NO_PERF: MeowChannelPerf = { byModel: new Map(), windowEnd: undefined }

const SONNET: PricingModel = {
  id: 1,
  model_name: 'claude-sonnet',
  quota_type: 0,
  model_ratio: 1.5,
  completion_ratio: 5,
  cache_ratio: 0.1,
  context_length: 200_000,
  enable_groups: ['official', 'kiro'],
}
const TOOL: PricingModel = {
  id: 3,
  model_name: 'claude-tool',
  quota_type: 1,
  model_price: 0.04,
  model_ratio: 0,
  completion_ratio: 0,
  enable_groups: ['official'],
}
const TIERED: PricingModel = {
  id: 4,
  model_name: 'claude-tiered',
  billing_mode: 'tiered_expr',
  billing_expr:
    'len <= 200000 ? tier("short", p * 2 + c * 8) : tier("long", p * 4 + c * 16)',
  quota_type: 0,
  model_ratio: 0,
  completion_ratio: 0,
  enable_groups: ['all'],
}
const GPT: PricingModel = {
  id: 2,
  model_name: 'gpt-6-sol',
  quota_type: 0,
  model_ratio: 1.25,
  completion_ratio: 4,
  enable_groups: ['official'],
}

function family(id: MeowFamilyId): MeowFamily {
  const found = buildMeowCatalog(
    [SONNET, TOOL, TIERED, GPT],
    { official: 'Official', kiro: 'Kiro' },
    GROUP_RATIO
  ).find((item) => item.id === id)
  if (!found) throw new Error(`family ${id} not built`)
  return found
}

function perfGroup(group: string, successRate: number): PerformanceGroup {
  return {
    group,
    success_rate: successRate,
    avg_latency_ms: 1300,
    avg_tps: 74,
    avg_ttft_ms: 400,
    series: [
      {
        ts: LAST_HOUR,
        success_rate: successRate,
        avg_latency_ms: 1300,
        avg_tps: 74,
        avg_ttft_ms: 400,
      },
    ],
  }
}

function renderFamily(
  id: MeowFamilyId,
  options: { perf?: MeowChannelPerf; onSelect?: (name: string) => void } = {}
) {
  return render(
    <MeowFamilyCard
      family={family(id)}
      prices={PRICES}
      perf={options.perf ?? NO_PERF}
      onSelect={options.onSelect ?? vi.fn()}
    />
  )
}

function sonnetRow(tableName: string) {
  return within(screen.getByRole('table', { name: tableName })).getByRole(
    'row',
    { name: /claude-sonnet/ }
  )
}

describe('meow family card', () => {
  it('shows a model in each channel with that channel multiplier applied', () => {
    renderFamily('claude')

    const official = sonnetRow('Claude · Official')
    expect(official).toHaveTextContent('$4.5')
    expect(official).toHaveTextContent('$22.5')
    expect(official).toHaveTextContent('$0.45')
    const kiro = sonnetRow('Claude · Kiro')
    expect(kiro).toHaveTextContent('$2.7')
    expect(kiro).toHaveTextContent('$13.5')
    expect(kiro).toHaveTextContent('$0.27')
  })

  it('shows the context window under the model name', () => {
    renderFamily('claude')

    expect(sonnetRow('Claude · Official')).toHaveTextContent('200K context')
  })

  it('shows a dash in the cache column when a model has no cache price', () => {
    renderFamily('gpt')

    const row = within(
      screen.getByRole('table', { name: 'GPT · Official' })
    ).getByRole('row', { name: /gpt-6-sol/ })
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('—')
  })

  it('gives each channel its own heading when a family has several channels', () => {
    renderFamily('claude')

    const card = screen.getByRole('region', { name: 'Claude' })
    expect(
      within(card)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual(['Official', 'Kiro'])
  })

  it('shows a single channel in the family header without a channel heading', () => {
    renderFamily('gpt')

    const card = screen.getByRole('region', { name: 'GPT' })
    expect(within(card).queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    expect(within(card).getByText('Official')).toBeInTheDocument()
    expect(
      within(card).getByRole('button', { name: 'Copy group name' })
    ).toBeInTheDocument()
    expect(within(card).getAllByRole('table')).toHaveLength(1)
  })

  it('opens a model when its name is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderFamily('claude', { onSelect })

    await user.click(
      within(sonnetRow('Claude · Official')).getByRole('button', {
        name: 'claude-sonnet',
      })
    )

    expect(onSelect).toHaveBeenCalledWith('claude-sonnet')
  })

  it('opens a model with the Enter key on its name', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderFamily('claude', { onSelect })

    within(sonnetRow('Claude · Official'))
      .getByRole('button', { name: 'claude-sonnet' })
      .focus()
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith('claude-sonnet')
  })

  it('copies a model name without opening the model', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderFamily('claude', { onSelect })

    await user.click(
      within(sonnetRow('Claude · Official')).getByRole('button', {
        name: 'Copy model name',
      })
    )

    expect(onSelect).not.toHaveBeenCalled()
    await expect(navigator.clipboard.readText()).resolves.toBe('claude-sonnet')
  })

  it('shows a per-request price across the price columns with the channel multiplier', () => {
    renderFamily('claude')

    const row = within(
      screen.getByRole('table', { name: 'Claude · Official' })
    ).getByRole('row', { name: /claude-tool/ })
    const cells = within(row).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('$0.06 / request')
    expect(cells[1]).toHaveAttribute('aria-colspan', '3')
    expect(cells).toHaveLength(4)
  })

  it('shows expression prices with the channel multiplier applied once and notes the tiers', () => {
    renderFamily('claude')

    const mergedCell = (tableName: string) =>
      within(
        within(screen.getByRole('table', { name: tableName })).getByRole(
          'row',
          { name: /claude-tiered/ }
        )
      ).getAllByRole('cell')[1]
    const official = mergedCell('Claude · Official')
    expect(within(official).getByTitle(/^3(\.0+)?$/)).toBeInTheDocument()
    expect(official).toHaveTextContent('2 tiers')
    expect(
      within(mergedCell('Claude · Kiro')).getByTitle(/^1\.8(0+)?$/)
    ).toBeInTheDocument()
  })

  it('shows each channel its own success rate and speed', () => {
    renderFamily('claude', {
      perf: {
        byModel: new Map([
          [
            'claude-sonnet',
            new Map([
              ['official', perfGroup('official', 99.95)],
              ['kiro', perfGroup('kiro', 97.8)],
            ]),
          ],
        ]),
        windowEnd: LAST_HOUR,
      },
    })

    const official = sonnetRow('Claude · Official')
    expect(official).toHaveTextContent('99.95%')
    expect(official).toHaveTextContent('1.30s · 74.0 t/s')
    expect(sonnetRow('Claude · Kiro')).toHaveTextContent('97.80%')
  })

  it('shows dashes for metrics and keeps prices when a channel has no metrics', () => {
    renderFamily('claude')

    const cells = within(sonnetRow('Claude · Official')).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('$4.5')
    expect(cells[4]).toHaveTextContent('—')
    expect(cells[5]).toHaveTextContent('—')
  })
})
