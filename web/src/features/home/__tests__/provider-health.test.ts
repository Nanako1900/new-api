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
import { expect, test } from 'vitest'

import {
  canShowLiveStatus,
  summarizeProviderHealth,
} from '../lib/provider-health'

test('a provider with no measured models reports null', () => {
  const health = summarizeProviderHealth(
    [{ model_name: 'gpt-6', success_rate: 80, avg_latency_ms: 3000 }],
    []
  )
  expect(health.claude).toBeNull()
  expect(health.gpt).toEqual({ successRate: 80, avgLatencyMs: 3000 })
})

test('the busiest model, listed first, decides a provider', () => {
  const health = summarizeProviderHealth(
    [
      { model_name: 'gpt-a', success_rate: 96.36, avg_latency_ms: 54000 },
      { model_name: 'gpt-b', success_rate: 100, avg_latency_ms: 4000 },
      { model_name: 'gpt-c', success_rate: 0, avg_latency_ms: 0 },
    ],
    []
  )
  expect(health.gpt).toEqual({ successRate: 96.36, avgLatencyMs: 54000 })
})

test('the pricing vendor decides the provider when the name is ambiguous', () => {
  const health = summarizeProviderHealth(
    [{ model_name: 'sonnet-latest', success_rate: 99, avg_latency_ms: 800 }],
    [{ model_name: 'sonnet-latest', vendor_name: 'Anthropic' }]
  )
  expect(health.claude?.successRate).toBe(99)
  expect(health.gpt).toBeNull()
})

test('a busier image model does not stand for chat health', () => {
  const health = summarizeProviderHealth(
    [
      { model_name: 'gpt-image-2', success_rate: 40, avg_latency_ms: 9000 },
      { model_name: 'gpt-6', success_rate: 99, avg_latency_ms: 2000 },
      { model_name: 'claude-embedding', success_rate: 97, avg_latency_ms: 300 },
    ],
    []
  )
  expect(health.gpt).toEqual({ successRate: 99, avgLatencyMs: 2000 })
  // With no chat traffic, the busiest secondary model still counts.
  expect(health.claude).toEqual({ successRate: 97, avgLatencyMs: 300 })
})

test('a busiest model without latency reports latency as unknown', () => {
  const health = summarizeProviderHealth(
    [
      { model_name: 'claude-a', success_rate: 100, avg_latency_ms: 0 },
      { model_name: 'claude-b', success_rate: 100, avg_latency_ms: 1200 },
    ],
    []
  )
  expect(health.claude?.successRate).toBe(100)
  expect(health.claude?.avgLatencyMs).toBeNaN()
})

test('live status shows when every provider is at or above 95%', () => {
  const health = {
    claude: { successRate: 95, avgLatencyMs: 5000 },
    gpt: { successRate: 99.5, avgLatencyMs: 9000 },
  }
  expect(canShowLiveStatus(health)).toBe(true)
})

test('live status hides when any provider is below 95%', () => {
  const health = {
    claude: { successRate: 99, avgLatencyMs: 5000 },
    gpt: { successRate: 94.99, avgLatencyMs: 9000 },
  }
  expect(canShowLiveStatus(health)).toBe(false)
})

test('live status hides when a provider has no measurements', () => {
  const health = {
    claude: { successRate: 99, avgLatencyMs: 5000 },
    gpt: null,
  }
  expect(canShowLiveStatus(health)).toBe(false)
})
