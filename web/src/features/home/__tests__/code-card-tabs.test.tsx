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
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { MeowCodeCard } from '../components/meow/meow-code-card'

const SITE = 'https://meowapi.dev'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

function renderCard() {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { server_address: SITE } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MeowCodeCard />
    </QueryClientProvider>
  )
}

// The other demos stay mounted so the card keeps the tallest one's height;
// the height itself is checked in the browser, since jsdom has no layout.
test('switching protocol tabs keeps the other requests mounted but hidden from assistive tech', async () => {
  renderCard()

  await userEvent.click(screen.getByRole('tab', { name: 'Chat' }))

  const chatUrl = await screen.findByText(`"${SITE}/v1/chat/completions"`)
  const claudeUrl = screen.getByText(`"${SITE}/v1/messages"`)
  expect(chatUrl.closest('[aria-hidden="true"]')).toBeNull()
  expect(claudeUrl.closest('[aria-hidden="true"]')).not.toBeNull()
})

test('the copy button copies only the selected request', async () => {
  const user = userEvent.setup()
  renderCard()
  await screen.findByText(`"${SITE}/v1/messages"`)

  await user.click(screen.getByRole('tab', { name: 'Responses' }))
  await user.click(screen.getByRole('button', { name: /copy/i }))

  const copied = await navigator.clipboard.readText()
  expect(copied).toContain(`"${SITE}/v1/responses"`)
  expect(copied).not.toContain('/v1/messages')
})
