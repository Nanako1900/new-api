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
import { render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { BasicAuthSection } from '../basic-auth-section'

const defaults = {
  PasswordLoginEnabled: true,
  PasswordRegisterEnabled: true,
  RegisterEnabled: true,
  EmailDomainRestrictionEnabled: false,
  EmailAliasRestrictionEnabled: false,
  EmailDomainWhitelist: '',
}

async function renderSettings(status: SystemStatus) {
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
          <BasicAuthSection defaultValues={defaults} />
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
