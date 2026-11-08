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
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { MeowProfileHeader } from '../components/meow-profile-header'
import type { UserProfile } from '../types'

const PROFILE = {
  id: 7,
  username: 'meowfan',
  display_name: 'Meow Fan',
  role: 1,
  email: 'meowfan@example.com',
  group: 'default',
  quota: 500000,
  used_quota: 250000,
  request_count: 12,
  status: 1,
  aff_count: 0,
  aff_quota: 0,
  aff_history_quota: 0,
  created_time: 0,
} as UserProfile

function renderHeader() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MeowProfileHeader profile={PROFILE} loading={false} />
    </QueryClientProvider>
  )
}

test('the profile card leads with the name as the page heading', () => {
  renderHeader()

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Meow Fan'
  )
  expect(screen.getByText('meowfan@example.com')).toBeInTheDocument()
})

test('the profile card lists the balance, usage and requests as labelled figures', () => {
  renderHeader()

  expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
    'Current Balance',
    'Total Usage',
    'API Requests',
  ])
  expect(screen.getAllByRole('definition')).toHaveLength(3)
})

test('the large profile avatar opens the avatar editor', async () => {
  renderHeader()

  fireEvent.click(screen.getByRole('button', { name: 'Change avatar' }))

  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})
