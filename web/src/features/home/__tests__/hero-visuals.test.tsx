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
import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { MeowHeroVisual } from '../components/meow/hero-visuals'
import type { HomeHeroVisual } from '../lib/hero-visual'

const SITE = 'https://meowapi.dev'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

// The test setup prefers reduced motion, so every visual renders its
// finished state: all call-log rows, typed URLs and the full chat reply.
function renderVisual(options: {
  saved?: unknown
  visual?: HomeHeroVisual
  models?: Array<{ model_name: string; vendor_id: number }>
}) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/pricing') {
      return {
        data: {
          success: true,
          data: options.models ?? [],
          vendors: [
            { id: 1, name: 'Anthropic' },
            { id: 2, name: 'OpenAI' },
          ],
        },
      }
    }
    return {
      data: {
        success: true,
        data: { server_address: SITE, home_hero_visual: options.saved },
      },
    }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MeowHeroVisual visual={options.visual} />
    </QueryClientProvider>
  )
}

test('the home hero shows the visual saved in the site status', async () => {
  renderVisual({ saved: 'gateway' })

  expect(
    await screen.findByRole('img', { name: /routing map/i })
  ).toBeInTheDocument()
})

test('an unknown saved visual falls back to the key card', async () => {
  renderVisual({ saved: 'carousel' })

  expect(
    await screen.findByRole('img', { name: /API key card/i })
  ).toBeInTheDocument()
})

test('the code card option keeps the copyable request examples', async () => {
  renderVisual({ saved: 'code-card' })

  expect(await screen.findByText(`"${SITE}/v1/messages"`)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
})

test('the key card names its example calls after the site’s models', async () => {
  renderVisual({
    visual: 'key-card',
    models: [
      { model_name: 'claude-sonnet-4-5', vendor_id: 1 },
      { model_name: 'gpt-5', vendor_id: 2 },
    ],
  })

  expect(
    (await screen.findAllByText('claude-sonnet-4-5')).length
  ).toBeGreaterThan(0)
  expect(screen.getAllByText('gpt-5').length).toBeGreaterThan(0)
})

test('the base URL visual points both SDK variables at this site', async () => {
  renderVisual({ visual: 'base-url' })

  expect(await screen.findByText(SITE)).toBeInTheDocument()
  expect(screen.getByText(`${SITE}/v1`)).toBeInTheDocument()
  expect(screen.getByText('https://api.anthropic.com')).toBeInTheDocument()
})

test('with reduced motion the chat shows the finished reply at once', async () => {
  renderVisual({ visual: 'base-url' })

  expect(
    await screen.findByText(
      'Here and ready. Same SDK, same code, just a new Base URL.'
    )
  ).toBeInTheDocument()
  expect(screen.getByText('Logged to usage')).toBeInTheDocument()
})
