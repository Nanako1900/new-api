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
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { STATUS_QUERY_KEY, type StatusData } from '@/lib/status-query'

import { ApiAddressStrip } from '../api-address-strip'

let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  localStorage.clear()
})

function renderAddresses(status: StatusData) {
  client.setQueryData(STATUS_QUERY_KEY, status)
  return render(
    <QueryClientProvider client={client}>
      <ApiAddressStrip />
    </QueryClientProvider>
  )
}

it('shows the first route inline and expands other routes without changing their URLs', async () => {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, 'writeText')
  renderAddresses({
    server_address: 'https://console.example.com',
    api_info_enabled: true,
    api_info: [
      {
        route: 'Global',
        description: 'Worldwide access',
        url: 'https://api.example.com/v1',
        color: 'blue',
      },
      {
        route: 'Asia',
        description: 'Regional access',
        url: 'https://asia.example.com/gateway/v1/',
        color: 'green',
      },
    ],
  })

  const strip = within(screen.getByRole('region', { name: 'API Addresses' }))
  expect(strip.getByText('https://api.example.com/v1')).toBeVisible()
  expect(strip.queryByText('Asia')).not.toBeInTheDocument()
  const more = strip.getByRole('button', { name: /More routes/ })
  more.focus()
  await user.keyboard('{Enter}')
  expect(more).toHaveAttribute('aria-expanded', 'true')
  expect(strip.getByText(/Worldwide access/)).toBeVisible()
  expect(strip.getByText('Regional access')).toBeVisible()
  const url = 'https://asia.example.com/gateway/v1/'
  expect(strip.getByText(url)).toBeVisible()
  await user.click(strip.getByRole('button', { name: `Copy API URL: ${url}` }))
  expect(writeText).toHaveBeenCalledWith(url)
  expect(await strip.findByRole('button', { name: 'Copied' })).toBeVisible()
  await user.click(strip.getByRole('button', { name: /Hide routes/ }))
  expect(more).toHaveAttribute('aria-expanded', 'false')
  expect(strip.getByText('https://api.example.com/v1')).toBeVisible()
})

it.each([
  {
    status: {
      api_info: [],
      server_address: 'https://gateway.example.com/proxy/',
    },
    label: 'Default API address',
    url: 'https://gateway.example.com/proxy/',
  },
  {
    status: { api_info: [] },
    label: 'Current domain',
    url: window.location.origin,
  },
  {
    status: {
      api_info_enabled: false,
      api_info: [
        {
          route: 'Hidden',
          description: 'Disabled address',
          url: 'https://hidden.example.com',
          color: 'blue',
        },
      ],
      server_address: 'https://gateway.example.com',
    },
    label: 'Default API address',
    url: 'https://gateway.example.com',
  },
])(
  'shows and copies the fallback $label when no configured addresses are available',
  async ({ status, label, url }) => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderAddresses(status)

    const strip = within(screen.getByRole('region', { name: 'API Addresses' }))
    expect(strip.getByText(label)).toBeVisible()
    expect(strip.getByText(url)).toBeVisible()
    expect(strip.queryByRole('button', { name: /More routes/ })).toBeNull()
    expect(strip.queryByText('Hidden')).toBeNull()
    await user.tab()
    expect(
      strip.getByRole('button', { name: `Copy API URL: ${url}` })
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(writeText).toHaveBeenCalledWith(url)
  }
)

it('wraps a long single route and switches the copied address when settings change', async () => {
  const user = userEvent.setup()
  const url =
    'https://regional-api-gateway.example.com/organization/production/openai-compatible/v1/'
  renderAddresses({
    api_info: [
      {
        route: 'Regional gateway',
        description: 'Regional production gateway',
        url,
        color: 'blue',
      },
    ],
  })
  const strip = within(screen.getByRole('region', { name: 'API Addresses' }))
  expect(strip.getByText(url)).toHaveClass('break-all')
  expect(strip.getByText('Regional production gateway')).toBeVisible()

  act(() => {
    client.setQueryData(STATUS_QUERY_KEY, {
      api_info: [
        {
          route: 'Replacement',
          description: 'Updated gateway',
          url: 'https://new.example.com',
          color: 'blue',
        },
      ],
    })
  })
  expect(await strip.findByText('https://new.example.com')).toBeVisible()
  expect(strip.queryByText(url)).not.toBeInTheDocument()
  await user.click(
    strip.getByRole('button', {
      name: 'Copy API URL: https://new.example.com',
    })
  )
  expect(await navigator.clipboard.readText()).toBe('https://new.example.com')
})
