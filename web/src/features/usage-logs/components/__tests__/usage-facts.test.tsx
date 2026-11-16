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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import type { UsageLog } from '../../data/schema'
import type { LogOtherData } from '../../types'
import { DetailsDialog } from '../dialogs/details-dialog'

const i18nKeys = {
  'Log Details': 'Log Details',
  Consume: 'Consume',
  'Billing Details': 'Billing Details',
  'Billing Mode': 'Billing Mode',
  'Per-token': 'Per-token',
  'Dynamic Pricing': 'Dynamic Pricing',
  'Matched Tier': 'Matched Tier',
  'Group Ratio': 'Group Ratio',
  'Total Cost': 'Total Cost',
  'Usage parameters': 'Usage parameters',
}

function makeLog(other: LogOtherData): UsageLog {
  return {
    id: 1,
    user_id: 1,
    created_at: 1,
    type: 2,
    content: '',
    username: 'user',
    token_name: 'token',
    model_name: 'wan2.5-i2v-preview',
    quota: 5000,
    prompt_tokens: 0,
    completion_tokens: 0,
    use_time: 0,
    is_stream: false,
    channel: 1,
    channel_name: '',
    token_id: 1,
    group: 'default',
    ip: '',
    other: JSON.stringify(other),
    request_id: 'req-1',
    upstream_request_id: '',
  }
}

function renderDetails(other: LogOtherData, promptTokens = 0): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const freshAt = Date.now() + 60_000
  queryClient.setQueryData(['status'], {}, { updatedAt: freshAt })
  queryClient.setQueryData(
    ['pricing'],
    { data: [], vendors: [] },
    { updatedAt: freshAt }
  )

  render(
    <QueryClientProvider client={queryClient}>
      <DetailsDialog
        log={{ ...makeLog(other), prompt_tokens: promptTokens }}
        isAdmin={false}
        isRoot={false}
        open
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  )
  return queryClient
}

function rowValue(label: string): string | null {
  return (
    screen.getByText(label, { selector: 'span.text-muted-foreground' })
      .nextElementSibling?.textContent ?? null
  )
}

test('shows recorded channel prices in both breakdowns without exposing multipliers', () => {
  const original = useSystemConfigStore.getState().config.currency
  useSystemConfigStore.setState((state) => ({
    config: {
      ...state.config,
      currency: { ...original, quotaDisplayType: 'CNY', usdExchangeRate: 1 },
    },
  }))
  const queryClient = renderDetails({
    billing_mode: 'tiered_expr',
    expr_b64: Buffer.from(
      'tier("0_272k", p * 10 + c * 50 + cr * 1 + cc * 12.5 + cc12h * 25)'
    ).toString('base64'),
    matched_tier: '0_272k',
    group_ratio: 0.3,
    cache_tokens: 10,
  })
  try {
    expect(rowValue('Input')).toBe('¥3/M')
    expect(rowValue('Output')).toBe('¥15/M')
    expect(rowValue('Cache Read')).toBe('¥0.3/M')
    expect(rowValue('Cache Write')).toBe('¥3.75/M')
    expect(rowValue('Cache Write (12h)')).toBe('¥7.5/M')
    expect(screen.getAllByText('¥3').length).toBeGreaterThan(0)
    expect(screen.getAllByText('¥15').length).toBeGreaterThan(0)
    expect(screen.queryByText('Group Ratio')).not.toBeInTheDocument()
    expect(screen.queryByText('0.3000x')).not.toBeInTheDocument()
    expect(rowValue('Total Cost')).toBe('¥0.01')
  } finally {
    queryClient.clear()
    useSystemConfigStore.setState((state) => ({
      config: { ...state.config, currency: original },
    }))
  }
})

test.each([0, 0.2])(
  'uses the recorded exclusive group price %s and only matched request rules',
  (ratio) => {
    const queryClient = renderDetails({
      billing_mode: 'tiered_expr',
      expr_b64: Buffer.from(
        '(tier("base", p * 10 + c * 50)) * (param("fast") == true ? 2 : 1)'
      ).toString('base64'),
      matched_tier: 'base',
      group_ratio: 0.3,
      user_group_ratio: ratio,
      request_rules: [
        { cond: 'param("fast") == true', multiplier: 2, matched: true },
        { cond: 'param("other") == true', multiplier: 5, matched: false },
      ],
    })
    expect(rowValue('Input')).toBe(`$${ratio * 20}/M`)
    expect(rowValue('Output')).toBe(`$${ratio * 100}/M`)
    expect(screen.getAllByText(`$${ratio * 20}`).length).toBeGreaterThan(0)
    expect(screen.queryByText('User Exclusive Ratio')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Conditional multipliers')
    ).not.toBeInTheDocument()
    queryClient.clear()
  }
)

test('does not invent final unit prices when an older conditional log has no rule trace', () => {
  const queryClient = renderDetails({
    billing_mode: 'tiered_expr',
    expr_b64: Buffer.from(
      '(tier("base", p * 10 + c * 50)) * (param("fast") == true ? 2 : 1)'
    ).toString('base64'),
    matched_tier: 'base',
    group_ratio: 0.3,
  })
  expect(rowValue('Input')).toBe('—/M')
  expect(rowValue('Output')).toBe('—/M')
  expect(rowValue('Total Cost')).toBe('$0.01')
  expect(screen.queryByText('Conditional multipliers')).not.toBeInTheDocument()
  queryClient.clear()
})

test('keeps per-image prices per image while applying the historical group price', () => {
  const queryClient = renderDetails({
    billing_mode: 'tiered_expr',
    expr_b64: Buffer.from('tier("image", fixed(0.2)) * image_count').toString(
      'base64'
    ),
    matched_tier: 'image',
    billing_unit: 'request',
    fixed_price: 0.2,
    image_count: 4,
    group_ratio: 0.3,
  })
  expect(rowValue('Per image')).toBe('$0.06/image')
  expect(screen.getAllByText('$0.06/image').length).toBeGreaterThan(1)
  queryClient.clear()
})

test('shows the recorded request and response models in log details', () => {
  const queryClient = renderDetails({
    response_model: {
      requested_model: 'requested-model',
      upstream_model: 'mapped-model',
      returned_model: 'unexpected-model',
    },
  })
  expect(screen.getByText('Response model: unexpected-model')).toBeVisible()
  expect(rowValue('Request Model')).toBe('requested-model')
  expect(rowValue('Upstream Model')).toBe('mapped-model')
  expect(screen.getByText('unexpected-model')).toBeVisible()
  queryClient.clear()
})

test('splits OpenAI cache writes into 30-minute and 12-hour rows with their prices', () => {
  const queryClient = renderDetails(
    {
      model_ratio: 5,
      completion_ratio: 4,
      group_ratio: 1,
      cache_tokens: 2000,
      cache_ratio: 0.1,
      cache_creation_tokens: 1500,
      cache_creation_ratio: 1.25,
      cache_creation_tokens_12h: 1000,
      cache_creation_ratio_12h: 2.5,
    },
    4000
  )
  expect(rowValue('Cache Write (30m)')).toBe('500')
  expect(rowValue('Cache Write (12h)')).toBe('1,000')
  expect(screen.queryByText('Cache Write')).toBeNull()
  expect(rowValue('Cache Creation (30m)')).toBe('$12.5/M')
  expect(rowValue('Cache Creation (12h)')).toBe('$25/M')
  queryClient.clear()
})

test('keeps one cache write row and no cache prices for OpenAI logs without 12-hour writes', () => {
  const queryClient = renderDetails(
    {
      model_ratio: 5,
      completion_ratio: 4,
      group_ratio: 1,
      cache_tokens: 2000,
      cache_ratio: 0.1,
      cache_creation_tokens: 1500,
      cache_creation_ratio: 1.25,
    },
    4000
  )
  expect(rowValue('Cache Write')).toBe('1,500')
  expect(screen.queryByText('Cache Write (30m)')).toBeNull()
  expect(screen.queryByText('Cache Creation (30m)')).toBeNull()
  expect(screen.queryByText('Cache Creation')).toBeNull()
  queryClient.clear()
})

describe('usage facts billing details', () => {
  test('shows the settled image count and a per-image price', () => {
    const queryClient = renderDetails({
      billing_mode: 'tiered_expr',
      expr_b64: btoa('tier("image", fixed(0.04)) * image_count'),
      billing_unit: 'request',
      fixed_price: 0.04,
      image_count: 2,
      matched_tier: 'image',
    })
    expect(
      screen.getByText('Billable image count').parentElement
    ).toHaveTextContent('2')
    expect(screen.getAllByText(/\/image/).length).toBeGreaterThan(0)
    queryClient.clear()
  })
  const queryClients: QueryClient[] = []

  test('shows actual billable image and cache tokens while retaining the aggregate cache count', () => {
    queryClients.push(
      renderDetails(
        {
          billing_mode: 'tiered_expr',
          expr_b64: btoa(
            'tier("standard", p * 5 + cr * 1.25 + img * 8 + img_cr * 2 + c * 30)'
          ),
          matched_tier: 'standard',
          cache_tokens: 300,
          image_cache_tokens: 200,
          billing_tokens: { p: 300, cr: 100, img: 400, img_cr: 200, c: 100 },
        },
        1000
      )
    )
    const billable = within(
      screen.getByRole('group', { name: 'Billable token breakdown' })
    )
    expect(
      billable.getByText('Image Cache').nextElementSibling
    ).toHaveTextContent('200')
    expect(
      billable.getByText('Cache Read').nextElementSibling
    ).toHaveTextContent('100')
    expect(billable.getByText('Image In').nextElementSibling).toHaveTextContent(
      '400'
    )
    expect(
      screen.getByText('Input Tokens').nextElementSibling
    ).toHaveTextContent('1,000')
    expect(
      screen
        .getAllByText('Cache Read')
        .some((label) => label.nextElementSibling?.textContent === '300')
    ).toBe(true)
  })

  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', i18nKeys)
  })

  afterEach(() => {
    for (const queryClient of queryClients) {
      queryClient.clear()
    }
    queryClients.length = 0
  })

  test('renders one raw-key row per usage fact before total cost', () => {
    const expression = 'tier("720P", u("seconds") * 5)'
    queryClients.push(
      renderDetails({
        group_ratio: 1,
        billing_mode: 'tiered_expr',
        expr_b64: Buffer.from(expression, 'utf8').toString('base64'),
        matched_tier: '720P',
        usage_facts: {
          resolution: '720P',
          seconds: 5,
        },
      })
    )

    expect(screen.getByText('Usage parameters')).toBeInTheDocument()
    expect(rowValue('resolution')).toBe('720P')
    expect(rowValue('seconds')).toBe('5')
    expect(rowValue('Billing Mode')).toBe('Dynamic Pricing')
    expect(rowValue('Matched Tier')).toBe('720P')

    const usageHeader = screen.getByText('Usage parameters')
    const totalCost = screen.getByText('Total Cost')
    expect(
      usageHeader.compareDocumentPosition(totalCost) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  test('does not render usage parameter rows when usage_facts is absent', () => {
    queryClients.push(
      renderDetails({
        group_ratio: 1,
      })
    )

    expect(screen.queryByText('Usage parameters')).toBeNull()
    expect(screen.queryByText('resolution')).toBeNull()
    expect(screen.queryByText('seconds')).toBeNull()
    expect(screen.getByText('Total Cost')).toBeInTheDocument()
  })

  test('does not render usage parameter rows when usage_facts is empty', () => {
    queryClients.push(
      renderDetails({
        group_ratio: 1,
        usage_facts: {},
      })
    )

    expect(screen.queryByText('Usage parameters')).toBeNull()
    expect(screen.queryByText('resolution')).toBeNull()
    expect(screen.queryByText('seconds')).toBeNull()
    expect(screen.getByText('Total Cost')).toBeInTheDocument()
  })
})
