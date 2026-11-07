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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InternalAxiosRequestConfig } from 'axios'
import { useState, type ComponentType } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { UserAuthForm } from '../../sign-in/components/user-auth-form'
import { SignUpForm } from '../../sign-up/components/sign-up-form'
import type { SystemStatus } from '../../types'
import { WeChatLoginDialog } from '../wechat-login-dialog'

const originalAdapter = api.defaults.adapter
const wechatStatus: SystemStatus = {
  wechat_login: true,
  wechat_qrcode: 'https://example.com/wechat-qr.png',
}
let wechatRequests: InternalAxiosRequestConfig[] = []

async function renderInRouter(Component: ComponentType, status: SystemStatus) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, status)
  const route = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <Component />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

function dialogFixture(status: SystemStatus) {
  return function DialogFixture() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type='button' onClick={() => setOpen(true)}>
          Open WeChat
        </button>
        <WeChatLoginDialog open={open} onOpenChange={setOpen} status={status} />
      </>
    )
  }
}

beforeEach(() => {
  wechatRequests = []
  api.defaults.adapter = async (config) => {
    if (config.url === '/api/oauth/wechat') wechatRequests.push(config)
    return {
      data: { success: false, message: 'Invalid verification code' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
})

describe('WeChat login dialog', () => {
  it('shows the configured QR code and enables Confirm once a code is entered', async () => {
    const user = userEvent.setup()
    await renderInRouter(dialogFixture(wechatStatus), wechatStatus)
    const dialog = await screen.findByRole('dialog', { name: 'WeChat sign in' })
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' })

    expect(
      within(dialog).getByRole('img', { name: 'WeChat login QR code' })
    ).toHaveAttribute('src', 'https://example.com/wechat-qr.png')
    expect(confirm).toBeDisabled()

    await user.type(
      within(dialog).getByLabelText('Verification code'),
      '123456'
    )
    expect(confirm).toBeEnabled()
  })

  it('without a QR code, says that WeChat sign-in is not configured', async () => {
    const status = { wechat_login: true }
    await renderInRouter(dialogFixture(status), status)
    const dialog = await screen.findByRole('dialog', { name: 'WeChat sign in' })

    expect(within(dialog).queryByRole('img')).toBeNull()
    expect(
      within(dialog).getByText(
        'QR code is not configured. Please contact support.'
      )
    ).toBeInTheDocument()
  })

  it('after a rejected code, stays open so the user can try again', async () => {
    const showError = vi.spyOn(toast, 'error')
    const user = userEvent.setup()
    await renderInRouter(dialogFixture(wechatStatus), wechatStatus)
    const dialog = await screen.findByRole('dialog', { name: 'WeChat sign in' })

    await user.type(
      within(dialog).getByLabelText('Verification code'),
      '123456'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith('Invalid verification code')
    )
    expect(wechatRequests.map((config) => config.params)).toEqual([
      { code: '123456' },
    ])
    expect(screen.getByRole('dialog', { name: 'WeChat sign in' })).toBeVisible()
    expect(
      within(dialog).getByRole('button', { name: 'Confirm' })
    ).toBeEnabled()
  })

  it('after Cancel, opens again with an empty code field', async () => {
    const user = userEvent.setup()
    await renderInRouter(dialogFixture(wechatStatus), wechatStatus)
    const dialog = await screen.findByRole('dialog', { name: 'WeChat sign in' })
    await user.type(
      within(dialog).getByLabelText('Verification code'),
      '123456'
    )

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Open WeChat' }))

    const reopened = await screen.findByRole('dialog', {
      name: 'WeChat sign in',
    })
    expect(within(reopened).getByLabelText('Verification code')).toHaveValue('')
  })

  it.each([
    ['sign-in', UserAuthForm],
    ['sign-up', SignUpForm],
  ])(
    '%s: Continue with WeChat opens the WeChat sign-in dialog',
    async (_form, Form) => {
      const user = userEvent.setup()
      await renderInRouter(Form, wechatStatus)

      await user.click(
        await screen.findByRole('button', { name: 'Continue with WeChat' })
      )

      expect(
        await screen.findByRole('dialog', { name: 'WeChat sign in' })
      ).toBeInTheDocument()
    }
  )
})
