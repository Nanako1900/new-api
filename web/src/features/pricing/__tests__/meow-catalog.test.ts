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
import { describe, expect, it } from 'vitest'

import type { PerformanceSeriesPoint } from '@/features/performance-metrics/types'

import {
  buildMeowCatalog,
  type MeowFamily,
  STATUS_SLOT_COUNT,
  toStatusSlots,
} from '../lib/meow-catalog'
import type { PricingModel } from '../types'

const GROUP_RATIO = { official: 1.5, kiro: 0.9 }
// `/api/pricing` sends usable groups as group → description strings.
const USABLE_GROUPS = { official: '官方渠道', kiro: 'Kiro', auto: '自动' }

const HOUR = 3600
const LAST_HOUR = 1_800_000_000 // an exact hour boundary

function model(
  name: string,
  overrides: Partial<PricingModel> = {}
): PricingModel {
  return {
    id: 1,
    model_name: name,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['official'],
    ...overrides,
  }
}

function channelModels(family: MeowFamily | undefined) {
  return (family?.channels ?? []).map((channel) => [
    channel.group,
    channel.models.map((item) => item.model_name),
  ])
}

function point(ts: number, successRate: number): PerformanceSeriesPoint {
  return {
    ts,
    success_rate: successRate,
    avg_ttft_ms: 0,
    avg_latency_ms: 0,
    avg_tps: 0,
  }
}

describe('buildMeowCatalog', () => {
  it('groups models into Claude, GPT and other families in that order', () => {
    const families = buildMeowCatalog(
      [model('gemini-pro'), model('gpt-6-sol'), model('claude-sonnet')],
      USABLE_GROUPS,
      GROUP_RATIO
    )

    expect(families.map((family) => family.id)).toEqual([
      'claude',
      'gpt',
      'other',
    ])
  })

  it('leaves out a family without models', () => {
    const families = buildMeowCatalog(
      [model('claude-sonnet')],
      USABLE_GROUPS,
      GROUP_RATIO
    )

    expect(families.map((family) => family.id)).toEqual(['claude'])
  })

  it('lists a model only in the channels its enabled groups include', () => {
    const families = buildMeowCatalog(
      [
        model('claude-opus', { model_ratio: 7.5, enable_groups: ['official'] }),
        model('claude-haiku', { model_ratio: 0.5, enable_groups: ['kiro'] }),
        model('claude-sonnet', {
          model_ratio: 1.5,
          enable_groups: ['official', 'kiro'],
        }),
      ],
      USABLE_GROUPS,
      GROUP_RATIO
    )

    expect(channelModels(families[0])).toEqual([
      ['official', ['claude-opus', 'claude-sonnet']],
      ['kiro', ['claude-sonnet', 'claude-haiku']],
    ])
  })

  it('puts a model enabled for all groups in every channel', () => {
    const families = buildMeowCatalog(
      [model('claude-sonnet', { enable_groups: ['all'] })],
      USABLE_GROUPS,
      GROUP_RATIO
    )

    expect(channelModels(families[0])).toEqual([
      ['official', ['claude-sonnet']],
      ['kiro', ['claude-sonnet']],
    ])
  })

  it('skips the auto group and channels without models', () => {
    const families = buildMeowCatalog(
      [model('claude-sonnet', { enable_groups: ['official', 'auto'] })],
      { ...USABLE_GROUPS, idle: '空闲渠道' },
      GROUP_RATIO
    )

    expect(channelModels(families[0])).toEqual([
      ['official', ['claude-sonnet']],
    ])
  })

  it('orders channels by ratio from high to low', () => {
    const families = buildMeowCatalog(
      [model('claude-sonnet', { enable_groups: ['all'] })],
      { budget: 'Budget', official: 'Official', standard: 'Standard' },
      { budget: 0.5, official: 1.5, standard: 1 }
    )

    expect(families[0].channels.map((channel) => channel.group)).toEqual([
      'official',
      'standard',
      'budget',
    ])
  })

  it('orders models by billing type, then by base price from high to low', () => {
    const families = buildMeowCatalog(
      [
        model('claude-tool', { quota_type: 1, model_price: 0.02 }),
        model('claude-tiered', {
          billing_mode: 'tiered_expr',
          billing_expr: 'tier("base", p * 3 + c * 15)',
        }),
        model('claude-haiku', { model_ratio: 0.5 }),
        model('claude-opus', { model_ratio: 7.5 }),
        model('claude-batch-tool', { quota_type: 1, model_price: 0.05 }),
      ],
      USABLE_GROUPS,
      GROUP_RATIO
    )

    expect(channelModels(families[0])).toEqual([
      [
        'official',
        [
          'claude-opus',
          'claude-haiku',
          'claude-tiered',
          'claude-batch-tool',
          'claude-tool',
        ],
      ],
    ])
  })

  it('labels a channel with its group description, falling back to the group name', () => {
    const families = buildMeowCatalog(
      [model('claude-sonnet', { enable_groups: ['all'] })],
      { official: '官方渠道', kiro: { desc: '', ratio: 0.9 } },
      GROUP_RATIO
    )

    expect(
      families[0].channels.map((channel) => [channel.label, channel.ratio])
    ).toEqual([
      ['官方渠道', 1.5],
      ['kiro', 0.9],
    ])
  })
})

describe('toStatusSlots', () => {
  it('maps hourly samples onto 24 slots ending with the current hour', () => {
    const slots = toStatusSlots(
      [point(LAST_HOUR, 100), point(LAST_HOUR - 23 * HOUR, 50)],
      LAST_HOUR + 120
    )

    expect(slots).toHaveLength(STATUS_SLOT_COUNT)
    expect(slots[0]).toEqual({ ts: LAST_HOUR - 23 * HOUR, successRate: 50 })
    expect(slots[23]).toEqual({ ts: LAST_HOUR, successRate: 100 })
  })

  it('leaves hours without samples empty and ignores samples outside the window', () => {
    const slots = toStatusSlots(
      [point(LAST_HOUR - 24 * HOUR, 10), point(LAST_HOUR - HOUR, 99)],
      LAST_HOUR
    )

    expect(slots.filter((slot) => slot.successRate !== null)).toEqual([
      { ts: LAST_HOUR - HOUR, successRate: 99 },
    ])
  })
})
