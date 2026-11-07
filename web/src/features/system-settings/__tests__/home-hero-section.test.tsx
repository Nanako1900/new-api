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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../components/settings-page-context'
import { HomeHeroSection } from '../site/home-hero-section'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
})

function renderSection(savedValue: string) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { server_address: 'https://meowapi.dev' } },
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, message: '' } })
  const actions = document.createElement('div')
  document.body.appendChild(actions)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <HomeHeroSection defaultValue={savedValue} />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  return { put }
}

test('an unset option shows the key card as the selected visual', () => {
  renderSection('')

  expect(
    screen.getByRole('radio', { name: /Key card and call log/ })
  ).toBeChecked()
})

test('choosing a visual and saving stores it as HomeHeroVisual', async () => {
  const user = userEvent.setup()
  const { put } = renderSection('key-card')

  await user.click(screen.getByRole('radio', { name: /Gateway routing map/ }))
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'HomeHeroVisual',
      value: 'gateway',
    })
  )
})

test('saving without changing the saved visual sends no request', async () => {
  const user = userEvent.setup()
  const { put } = renderSection('base-url')

  await user.click(screen.getByRole('button', { name: 'Save Changes' }))

  expect(put).not.toHaveBeenCalled()
})

test('the preview follows the selected visual before it is saved', async () => {
  const user = userEvent.setup()
  renderSection('key-card')

  await user.click(
    screen.getByRole('radio', { name: /Base URL swap and chat/ })
  )

  expect(
    await screen.findByRole('img', { name: /\.env file/ })
  ).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /API key card/ })).toBeNull()
})
