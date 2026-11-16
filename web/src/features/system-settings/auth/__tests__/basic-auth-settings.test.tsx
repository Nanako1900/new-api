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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { BasicAuthSection } from '../basic-auth-section'

const defaults = {
  PasswordLoginEnabled: true,
  PasswordRegisterEnabled: true,
  RegisterEnabled: true,
  UserIdStart: 1,
  EmailDomainRestrictionEnabled: false,
  EmailAliasRestrictionEnabled: false,
  EmailDomainWhitelist: '',
}

async function renderSettings(
  status: SystemStatus,
  values: Partial<typeof defaults> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, status)
  function Fixture() {
    const [container, setContainer] = useState<HTMLDivElement | null>(null)
    return (
      <QueryClientProvider client={client}>
        <div ref={setContainer} />
        <SettingsPageProvider actionsContainer={container}>
          <BasicAuthSection defaultValues={{ ...defaults, ...values }} />
        </SettingsPageProvider>
      </QueryClientProvider>
    )
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

describe('Basic Authentication user ID allocation', () => {
  it('shows the starting number and explains allocation for new users', async () => {
    await renderSettings({})

    const input = await screen.findByRole('spinbutton', {
      name: 'New user ID starting number',
    })
    expect(input).toHaveValue(1)
    expect(input).toHaveAccessibleDescription(
      'New users receive IDs in ascending order from this number, skipping occupied IDs, including deleted users. Progress is preserved across restarts. Changing this number starts a new scan; saving the same number keeps progress. Existing user IDs stay unchanged.'
    )
  })

  it.each([
    ['1', 1],
    ['10000', 10000],
    ['2147483647', 2147483647],
  ])('saving start %s sends its numeric value', async (value, expected) => {
    await renderSettings({}, { UserIdStart: 2 })
    const input = await screen.findByRole('spinbutton', {
      name: 'New user ID starting number',
    })

    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/option/', {
        key: 'UserIdStart',
        value: expected,
      })
    )
  })

  it.each(['0', '-1', '1.5', '2147483648'])(
    'invalid start %s shows a field error and prevents saving',
    async (value) => {
      await renderSettings({})
      const input = await screen.findByRole('spinbutton', {
        name: 'New user ID starting number',
      })

      fireEvent.change(input, { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

      await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
      expect(input).toHaveAccessibleDescription(
        expect.stringContaining(
          'User ID start must be an integer between 1 and 2147483647'
        )
      )
      expect(api.put).not.toHaveBeenCalled()
    }
  )

  it('saving an unchanged starting number makes no update', async () => {
    await renderSettings({})

    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
    )
    expect(api.put).not.toHaveBeenCalled()
  })

  it.each(['business rejection', 'network rejection'])(
    'a %s shows the server error and keeps the starting number editable',
    async (failure) => {
      if (failure === 'business rejection') {
        vi.mocked(api.put).mockResolvedValueOnce({
          data: { success: false, message: 'Setting could not be saved' },
        })
      } else {
        vi.mocked(api.put).mockRejectedValueOnce(
          new Error('Setting could not be saved')
        )
      }
      await renderSettings({})
      const input = await screen.findByRole('spinbutton', {
        name: 'New user ID starting number',
      })

      fireEvent.change(input, { target: { value: '10000' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(
        await screen.findByText('Setting could not be saved')
      ).toBeVisible()
      expect(input).toHaveValue(10000)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
      await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(input).toHaveAttribute('aria-invalid', 'false')
      )
    }
  )
})

describe('Basic Authentication email verification', () => {
  it('states that password sign-up always verifies email, with no switch to turn it off', async () => {
    await renderSettings({ email_delivery_configured: true })

    expect(await screen.findByRole('note')).toHaveTextContent(
      'Password sign-up always requires email verification.'
    )
    expect(
      screen.queryByRole('switch', { name: 'Email Verification' })
    ).toBeNull()
  })

  it('when email delivery is not configured, warns and links to the email settings', async () => {
    await renderSettings({ email_delivery_configured: false })

    const warning = await screen.findByRole('status')
    expect(warning).toHaveTextContent(
      'Email delivery is not configured, so password sign-up is unavailable.'
    )
    expect(
      within(warning).getByRole('link', { name: 'Configure email delivery' })
    ).toHaveAttribute('href', '/system-settings/operations/email')
  })

  it.each([
    ['configured', { email_delivery_configured: true }],
    ['not reported', {}],
  ])(
    'when email delivery is %s, shows no delivery warning',
    async (_case, status) => {
      await renderSettings(status)

      await screen.findByRole('note')
      expect(
        screen.queryByText(
          'Email delivery is not configured, so password sign-up is unavailable.'
        )
      ).toBeNull()
    }
  )
})
