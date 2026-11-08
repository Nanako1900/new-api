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
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { getUserAvatarUrl } from '@/lib/meow-avatar'
import { type AuthUser, useAuthStore } from '@/stores/auth-store'

import { MeowOverviewGreeting } from '../components/meow-overview/meow-overview-greeting'

const USER = {
  id: 7,
  username: 'meowfan',
  display_name: 'Meow Fan',
  role: 1,
} as AuthUser

/** jsdom never loads images; Base UI's avatar waits for a loaded one. */
class LoadedImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  referrerPolicy = ''
  crossOrigin: string | null = null
  srcset = ''
  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', LoadedImage)
  useAuthStore.getState().auth.setUser(USER)
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.setUser(null)
})

test('the overview greets the user beside their avatar', async () => {
  const { container } = render(<MeowOverviewGreeting />)

  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    'Meow Fan'
  )
  await vi.waitFor(() =>
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      getUserAvatarUrl(USER.id, USER.setting)
    )
  )
})

test('the overview avatar is only shown, with no way to change it there', async () => {
  const { container } = render(<MeowOverviewGreeting />)

  await vi.waitFor(() => expect(container.querySelector('img')).not.toBeNull())
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('link')).toBeNull()
})
