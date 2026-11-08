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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance, type i18n } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import type { UpdateOptionRequest } from '../../types'
import { BotProtectionSection } from '../bot-protection-section'

type BotProtectionDefaults = {
  GeetestCheckEnabled: boolean
  GeetestCheckMode: 'always' | 'risk'
  GeetestCaptchaId: string
  GeetestCaptchaKey: string
}

const freshSite: BotProtectionDefaults = {
  GeetestCheckEnabled: false,
  GeetestCheckMode: 'always',
  GeetestCaptchaId: '',
  GeetestCaptchaKey: '',
}

let testI18n: i18n

function Fixture(props: { defaults: BotProtectionDefaults }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  )

  return (
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={client}>
        <div ref={setContainer} />
        <SettingsPageProvider actionsContainer={container}>
          <BotProtectionSection defaultValues={props.defaults} />
        </SettingsPageProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

async function renderSettings(defaults: BotProtectionDefaults) {
  const route = createRootRoute({
    component: () => <Fixture defaults={defaults} />,
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

beforeEach(async () => {
  testI18n = createInstance()
  await testI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} }, zh },
    interpolation: { escapeValue: false },
  })
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

function spyOnSavedOptions() {
  return vi.spyOn(api, 'put').mockImplementation(async () => {
    return { data: { success: true, message: '' } } as never
  })
}

function savedOptions(put: ReturnType<typeof spyOnSavedOptions>) {
  return put.mock.calls.map(([, body]) => {
    const request = body as UpdateOptionRequest
    return [request.key, request.value]
  })
}

describe('Bot Protection settings saves', () => {
  it('saves the captcha ID and key before enabling GeeTest in one save', async () => {
    const put = spyOnSavedOptions()
    const user = userEvent.setup()
    await renderSettings(freshSite)
    await user.type(
      screen.getByRole('textbox', { name: 'Captcha ID' }),
      'captcha-id'
    )
    await user.type(screen.getByLabelText('Captcha Key'), 'captcha-key')
    await user.click(screen.getByRole('switch', { name: 'Enable GeeTest' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(3))
    expect(savedOptions(put)).toEqual([
      ['GeetestCaptchaId', 'captcha-id'],
      ['GeetestCaptchaKey', 'captcha-key'],
      ['GeetestCheckEnabled', true],
    ])
  })

  it('choosing to ask only when risky saves the mode before enabling GeeTest', async () => {
    const put = spyOnSavedOptions()
    const user = userEvent.setup()
    await renderSettings({
      ...freshSite,
      GeetestCaptchaId: 'captcha-id',
      GeetestCaptchaKey: 'captcha-key',
    })
    expect(screen.getByRole('radio', { name: /Every time/ })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: /Only when risky/ }))
    await user.click(screen.getByRole('switch', { name: 'Enable GeeTest' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(savedOptions(put)).toEqual([
      ['GeetestCheckMode', 'risk'],
      ['GeetestCheckEnabled', true],
    ])
  })

  it('on a site in risk mode, shows it chosen and saves only the mode when switched back', async () => {
    const put = spyOnSavedOptions()
    const user = userEvent.setup()
    await renderSettings({
      GeetestCheckEnabled: true,
      GeetestCheckMode: 'risk',
      GeetestCaptchaId: 'captcha-id',
      GeetestCaptchaKey: 'captcha-key',
    })
    expect(
      screen.getByRole('radiogroup', { name: 'When to ask for verification' })
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Only when risky/ })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: /Every time/ }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(savedOptions(put)).toEqual([['GeetestCheckMode', 'always']])
  })
})
