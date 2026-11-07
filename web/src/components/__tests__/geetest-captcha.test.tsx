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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GeetestCaptcha } from '../geetest-captcha'

type FakeConfig = {
  captchaId: string
  language: string
  product: string
  offlineCb?: () => void
}

/** Stands in for gt4.js: records each init and lets a test drive the widget. */
function installFakeGeetest(options: { offline?: boolean } = {}) {
  const configs: FakeConfig[] = []
  const destroy = vi.fn()
  let succeed = () => {}
  let fail = (_error: unknown) => {}
  const instance = {
    appendTo: (target: HTMLElement) => {
      const button = document.createElement('button')
      button.textContent = 'GeeTest button'
      target.appendChild(button)
      return instance
    },
    getValidate: () => ({
      lot_number: 'lot',
      captcha_output: 'output',
      pass_token: 'pass',
      gen_time: '1700000000',
      captcha_id: 'not-sent',
    }),
    onSuccess: (callback: () => void) => {
      succeed = callback
      return instance
    },
    onError: (callback: (error: unknown) => void) => {
      fail = callback
      return instance
    },
    destroy,
  }
  window.initGeetest4 = ((
    config: FakeConfig,
    callback: (captcha: typeof instance) => void
  ) => {
    configs.push(config)
    // gt4.js runs offlineCb when it cannot reach GeeTest, then still hands
    // back an instance.
    if (options.offline) config.offlineCb?.()
    callback(instance)
  }) as unknown as Window['initGeetest4']
  return {
    configs,
    destroy,
    succeed: () => act(() => succeed()),
    fail: () => act(() => fail({ code: '60000' })),
  }
}

async function setInterfaceLanguage(language: string) {
  if (!i18next.hasResourceBundle(language, 'translation')) {
    i18next.addResourceBundle(language, 'translation', {})
  }
  await act(() => i18next.changeLanguage(language))
}

afterEach(async () => {
  // Unmount first: a mounted widget would re-initialize on the language reset.
  cleanup()
  delete window.initGeetest4
  document.head
    .querySelectorAll('script[src*="geetest"]')
    .forEach((script) => script.remove())
  await act(() => i18next.changeLanguage('en'))
})

describe('GeetestCaptcha', () => {
  it.each([
    ['zhCN', 'zho'],
    ['zhTW', 'zho-tw'],
    ['en', 'eng'],
    ['fr', 'fra'],
    ['ru', 'rus'],
    ['ja', 'jpn'],
    ['vi', 'eng'],
    ['xx', 'eng'],
  ])(
    'with interface language %s, initializes GeeTest in %s',
    async (language, geetestLanguage) => {
      const geetest = installFakeGeetest()
      await setInterfaceLanguage(language)

      render(<GeetestCaptcha captchaId='captcha-id' onVerify={vi.fn()} />)

      await screen.findByRole('button', { name: 'GeeTest button' })
      expect(geetest.configs).toEqual([
        expect.objectContaining({
          captchaId: 'captcha-id',
          language: geetestLanguage,
          protocol: 'https://',
        }),
      ])
    }
  )

  it('when GeeTest succeeds, reports only the four result fields as the token', async () => {
    const geetest = installFakeGeetest()
    const onVerify = vi.fn()
    render(<GeetestCaptcha captchaId='captcha-id' onVerify={onVerify} />)
    await screen.findByRole('button', { name: 'GeeTest button' })

    geetest.succeed()

    expect(onVerify).toHaveBeenCalledTimes(1)
    expect(JSON.parse(onVerify.mock.calls[0][0])).toEqual({
      lot_number: 'lot',
      captcha_output: 'output',
      pass_token: 'pass',
      gen_time: '1700000000',
    })
  })

  it('when GeeTest reports an error, shows an alert once without re-initializing', async () => {
    const geetest = installFakeGeetest()
    const onError = vi.fn()
    render(
      <GeetestCaptcha
        captchaId='captcha-id'
        onVerify={vi.fn()}
        onError={onError}
      />
    )
    await screen.findByRole('button', { name: 'GeeTest button' })

    geetest.fail()

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(geetest.configs).toHaveLength(1)
  })

  it('when GeeTest is offline, shows the alert instead of its local-pass button', async () => {
    installFakeGeetest({ offline: true })
    const onError = vi.fn()
    render(
      <GeetestCaptcha
        captchaId='captcha-id'
        onVerify={vi.fn()}
        onError={onError}
      />
    )

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: 'GeeTest button' })
    ).not.toBeInTheDocument()
  })

  it('when unmounted, destroys the GeeTest widget', async () => {
    const geetest = installFakeGeetest()
    const view = render(
      <GeetestCaptcha captchaId='captcha-id' onVerify={vi.fn()} />
    )
    await screen.findByRole('button', { name: 'GeeTest button' })

    view.unmount()

    expect(geetest.destroy).toHaveBeenCalledTimes(1)
  })

  it('when gt4.js fails to load, shows an alert and reports the error', async () => {
    const onError = vi.fn()
    render(
      <GeetestCaptcha
        captchaId='captcha-id'
        onVerify={vi.fn()}
        onError={onError}
      />
    )
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[src="https://static.geetest.com/v4/gt4.js"]'
    )
    expect(script).not.toBeNull()

    act(() => {
      script?.dispatchEvent(new Event('error'))
    })

    expect(await screen.findByRole('alert')).toBeVisible()
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
  })
})
