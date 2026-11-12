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
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import type { PerformanceGroup } from '@/features/performance-metrics/types'
import zhCN from '@/i18n/locales/zh.json'

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
const NO_PERF: MeowChannelPerf = { byModel: new Map() }

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
            {
              windowEnd: LAST_HOUR,
              groups: new Map([
                ['official', perfGroup('official', 99.95)],
                ['kiro', perfGroup('kiro', 97.8)],
              ]),
            },
          ],
        ]),
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

  it('translates a group description that is a server text key', () => {
    i18next.addResource(
      'en',
      'translation',
      'Default group',
      'Standard channel'
    )
    try {
      const translated = buildMeowCatalog(
        [SONNET, GPT],
        { official: 'Default group' },
        GROUP_RATIO
      ).find((item) => item.id === 'claude')
      if (!translated) throw new Error('claude family not built')

      render(
        <MeowFamilyCard
          family={translated}
          prices={PRICES}
          perf={NO_PERF}
          onSelect={vi.fn()}
        />
      )

      expect(
        screen.getByRole('table', { name: 'Claude · Standard channel' })
      ).toBeInTheDocument()
      expect(screen.getByText('Standard channel')).toBeInTheDocument()
    } finally {
      delete i18next.getResourceBundle('en', 'translation')['Default group']
    }
  })
})

describe('meow family card official price comparison', () => {
  it('strikes the official prices under a channel priced below them', () => {
    renderFamily('claude')

    expect(
      within(sonnetRow('Claude · Kiro'))
        .getAllByRole('deletion')
        .map((price) => price.textContent)
    ).toEqual([
      'Official price $3',
      'Official price $15',
      'Official price $0.3',
    ])
  })

  it('shows no official prices in a channel priced above them', () => {
    renderFamily('claude')

    expect(
      within(sonnetRow('Claude · Official')).queryAllByRole('deletion')
    ).toHaveLength(0)
  })

  it('labels each channel with its price relative to the official price', () => {
    renderFamily('claude')

    const card = screen.getByRole('region', { name: 'Claude' })
    expect(within(card).getByText('10% off official price')).toBeInTheDocument()
    expect(within(card).getByText('1.5× official price')).toBeInTheDocument()
  })

  it('shows the lowest channel discount in a family with several channels', () => {
    renderFamily('claude')

    expect(
      within(screen.getByRole('region', { name: 'Claude' })).getByText(
        'Up to 10% off official price'
      )
    ).toBeInTheDocument()
  })

  it('shows no family discount when the family has one channel', () => {
    renderFamily('gpt')

    expect(screen.queryByText(/^Up to/)).not.toBeInTheDocument()
  })

  it('strikes the official per-request price in a discounted channel', () => {
    const ratios = { kiro: 0.5 }
    const discounted = buildMeowCatalog(
      [{ ...TOOL, enable_groups: ['kiro'] }],
      { kiro: 'Kiro' },
      ratios
    )[0]
    render(
      <MeowFamilyCard
        family={discounted}
        prices={{ ...PRICES, groupRatio: ratios }}
        perf={NO_PERF}
        onSelect={vi.fn()}
      />
    )

    const row = within(
      screen.getByRole('table', { name: 'Claude · Kiro' })
    ).getByRole('row', { name: /claude-tool/ })
    expect(row).toHaveTextContent('$0.02 / request')
    expect(within(row).getByRole('deletion')).toHaveTextContent(
      'Official price $0.04'
    )
  })

  it('labels a channel priced at the official price without struck prices', () => {
    const ratios = { official: 1, kiro: 0.9 }
    const sameFamily = buildMeowCatalog(
      [SONNET],
      { official: 'Official', kiro: 'Kiro' },
      ratios
    )[0]
    render(
      <MeowFamilyCard
        family={sameFamily}
        prices={{ ...PRICES, groupRatio: ratios }}
        perf={NO_PERF}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('Same as official price')).toBeInTheDocument()
    expect(
      within(sonnetRow('Claude · Official')).queryAllByRole('deletion')
    ).toHaveLength(0)
  })

  it('labels a free channel and the family as free of charge', () => {
    const ratios = { official: 1.5, free: 0 }
    const freeFamily = buildMeowCatalog(
      [{ ...SONNET, enable_groups: ['official', 'free'] }],
      { official: 'Official', free: 'Trial' },
      ratios
    )[0]
    render(
      <MeowFamilyCard
        family={freeFamily}
        prices={{ ...PRICES, groupRatio: ratios }}
        perf={NO_PERF}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getAllByText('Free of charge')).toHaveLength(2)
    expect(
      within(sonnetRow('Claude · Trial')).getAllByRole('deletion')
    ).toHaveLength(3)
  })

  it('shows no struck price that equals the discounted price', () => {
    const ratios = { kiro: 0.5 }
    const zeroFamily = buildMeowCatalog(
      [{ ...SONNET, model_ratio: 0, enable_groups: ['kiro'] }],
      { kiro: 'Kiro' },
      ratios
    )[0]
    render(
      <MeowFamilyCard
        family={zeroFamily}
        prices={{ ...PRICES, groupRatio: ratios }}
        perf={NO_PERF}
        onSelect={vi.fn()}
      />
    )

    expect(
      within(sonnetRow('Claude · Kiro')).queryAllByRole('deletion')
    ).toHaveLength(0)
  })

  it('writes a free channel as 免费 for simplified Chinese', async () => {
    const key = 'Free of charge'
    i18next.addResource('zhCN', 'translation', key, zhCN.translation[key])
    await i18next.changeLanguage('zhCN')
    try {
      const ratios = { free: 0 }
      const freeFamily = buildMeowCatalog(
        [{ ...SONNET, enable_groups: ['free'] }],
        { free: 'Trial' },
        ratios
      )[0]
      render(
        <MeowFamilyCard
          family={freeFamily}
          prices={{ ...PRICES, groupRatio: ratios }}
          perf={NO_PERF}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByText('免费')).toBeInTheDocument()
    } finally {
      await i18next.changeLanguage('en')
      i18next.removeResourceBundle('zhCN', 'translation')
    }
  })

  it('writes a channel discount in 折 for simplified Chinese', async () => {
    const key = '{{off}}% off official price'
    i18next.addResource('zhCN', 'translation', key, zhCN.translation[key])
    await i18next.changeLanguage('zhCN')
    try {
      renderFamily('claude')

      expect(screen.getByText('官方价 9 折')).toBeInTheDocument()
    } finally {
      await i18next.changeLanguage('en')
      i18next.removeResourceBundle('zhCN', 'translation')
    }
  })
})
