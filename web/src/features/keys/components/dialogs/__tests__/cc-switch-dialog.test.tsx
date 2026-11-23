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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPricing } from '@/features/pricing/api'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'
import {
  EMPTY_ONBOARDING_PROGRESS,
  useOnboardingStore,
} from '@/stores/onboarding-store'

import type { CCSwitchKey } from '../../../lib/cc-switch-defaults'
import { CCSwitchDialog } from '../cc-switch-dialog'

// The price list is the network boundary; tests seed it in the query cache
// and only reach this mock when they leave the cache empty on purpose.
vi.mock('@/features/pricing/api', () => ({ getPricing: vi.fn() }))

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
})

afterEach(() => {
  queryClient.clear()
  useAuthStore.getState().auth.setUser(null)
  useOnboardingStore.setState({ progress: {}, run: null })
  vi.restoreAllMocks()
  vi.mocked(getPricing).mockReset()
})

// The live site's groups each serve one model family; `其他` serves none
// that a CC Switch client runs.
const PRICING = [
  { model_name: 'claude-haiku-5-5', enable_groups: ['Claude Max'] },
  { model_name: 'claude-opus-5-5', enable_groups: ['Claude Max', 'Kiro 企业'] },
  {
    model_name: 'claude-sonnet-5-5',
    enable_groups: ['Claude Max', 'Kiro 企业'],
  },
  { model_name: 'deepseek-flash', enable_groups: ['其他'] },
  { model_name: 'gemini-3.8-flash', enable_groups: ['Gemini Ultra'] },
  { model_name: 'gemini-4-neon', enable_groups: ['Gemini Ultra'] },
  { model_name: 'gpt-6-astra', enable_groups: ['GPT Pro号池'] },
  { model_name: 'gpt-6.1-sol', enable_groups: ['GPT Pro号池'] },
]

const CLAUDE_KEY: CCSwitchKey = { group: 'Claude Max' }
const GPT_KEY: CCSwitchKey = { group: 'GPT Pro号池' }
const GEMINI_KEY: CCSwitchKey = { group: 'Gemini Ultra' }
// An Auto key that reaches every family, so every client can be picked.
const EVERY_FAMILY_KEY: CCSwitchKey = {
  group: 'auto',
  auto_groups: ['Claude Max', 'GPT Pro号池', 'Gemini Ultra'],
}

function renderDialog(
  apiKey: CCSwitchKey | null,
  pricing: unknown[] | null = PRICING
) {
  if (pricing) {
    queryClient.setQueryData(['pricing'], { success: true, data: pricing })
  }
  render(
    <QueryClientProvider client={queryClient}>
      <CCSwitchDialog
        open
        onOpenChange={vi.fn()}
        tokenKey='test-only'
        apiKey={apiKey}
      />
    </QueryClientProvider>
  )
}

const ANTIGRAVITY = 'Antigravity (Gemini)'
const ANTIGRAVITY_HINT =
  'Antigravity starts from the terminal button on its CC Switch card. Running agy on its own still signs in with Google.'

function primaryModel() {
  return screen.getByRole('combobox', { name: 'Primary Model' })
}

async function listedModels(app: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('radio', { name: app }))
  await user.click(primaryModel())
  await screen.findByRole('listbox')
  return screen.getAllByRole('option').map((option) => option.textContent)
}

describe('CC Switch client picked by the key group', () => {
  it('picks Claude and fills every Claude field for a Claude group key', () => {
    renderDialog(CLAUDE_KEY)

    expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'MeowAPI Claude'
    )
    expect(primaryModel()).toHaveValue('claude-opus-5-5')
    expect(screen.getByRole('combobox', { name: 'Haiku Model' })).toHaveValue(
      'claude-haiku-5-5'
    )
    expect(screen.getByRole('combobox', { name: 'Sonnet Model' })).toHaveValue(
      'claude-sonnet-5-5'
    )
    expect(screen.getByRole('combobox', { name: 'Opus Model' })).toHaveValue(
      'claude-opus-5-5'
    )
  })

  it('picks Codex on the newest GPT sol model for a GPT group key', () => {
    renderDialog(GPT_KEY)

    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'MeowAPI Codex'
    )
    expect(primaryModel()).toHaveValue('gpt-6.1-sol')
  })

  it('picks Gemini on the newest neon model for a Gemini group key', () => {
    renderDialog(GEMINI_KEY)

    expect(screen.getByRole('radio', { name: 'Gemini' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'MeowAPI Gemini'
    )
    expect(primaryModel()).toHaveValue('gemini-4-neon')
    expect(
      screen.queryByRole('combobox', { name: 'Haiku Model' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(ANTIGRAVITY_HINT)).not.toBeInTheDocument()
  })

  it('grays out the clients the key group has no models for and says why', () => {
    renderDialog(GPT_KEY)

    for (const app of ['Claude', 'Gemini', ANTIGRAVITY]) {
      expect(screen.getByRole('radio', { name: app })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
    expect(screen.getByRole('radio', { name: 'Codex' })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('radiogroup')).toHaveAccessibleDescription(
      'Not available with this key: Claude, Gemini, Antigravity (Gemini). Its group has no models for them.'
    )
  })

  it('grays out Codex for a Gemini group key and offers Gemini CLI and Antigravity', () => {
    renderDialog(GEMINI_KEY)

    for (const app of ['Claude', 'Codex']) {
      expect(screen.getByRole('radio', { name: app })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
    for (const app of ['Gemini', ANTIGRAVITY]) {
      expect(screen.getByRole('radio', { name: app })).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
    expect(screen.getByRole('radiogroup')).toHaveAccessibleDescription(
      'Not available with this key: Claude, Codex. Its group has no models for them.'
    )
  })

  it('names the Antigravity import and explains how it starts when Antigravity is picked', async () => {
    renderDialog(GEMINI_KEY)

    await userEvent
      .setup()
      .click(screen.getByRole('radio', { name: ANTIGRAVITY }))

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'MeowAPI Antigravity'
    )
    expect(primaryModel()).toHaveValue('gemini-4-neon')
    expect(screen.getByText(ANTIGRAVITY_HINT)).toBeVisible()
  })

  it('lets the four client options wrap onto a second line in a narrow dialog', () => {
    renderDialog(EVERY_FAMILY_KEY)

    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('radiogroup')).toHaveClass('flex-wrap')
  })

  it('takes the models of every group of an Auto key', () => {
    renderDialog({ group: 'auto', auto_groups: ['Kiro 企业', 'GPT Pro号池'] })

    expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Codex' })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Gemini' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(primaryModel()).toHaveValue('claude-opus-5-5')
  })

  it("uses the user's own group for a key without a group", () => {
    useAuthStore.getState().auth.setUser({
      id: 7,
      username: 'cat',
      group: 'Gemini Ultra',
    } as AuthUser)
    renderDialog({ group: '' })

    expect(screen.getByRole('radio', { name: 'Gemini' })).toBeChecked()
  })

  it("narrows the models to the key's model limits", async () => {
    renderDialog({
      ...GPT_KEY,
      model_limits_enabled: true,
      model_limits: 'gpt-6-astra',
    })

    expect(primaryModel()).toHaveValue('gpt-6-astra')
    expect(await listedModels('Codex')).toEqual(['gpt-6-astra'])
  })

  it('disables every client and the import when the key group has no supported model', () => {
    renderDialog({ group: '其他' })

    for (const app of ['Claude', 'Codex', 'Gemini', ANTIGRAVITY]) {
      expect(screen.getByRole('radio', { name: app })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
    expect(
      screen.getByRole('button', { name: 'Open CC Switch' })
    ).toBeDisabled()
    expect(screen.getByRole('radiogroup')).toHaveAccessibleDescription(
      "This key's group has no Claude, GPT or Gemini models. Change its group in the key list first."
    )
  })

  it("offers the user's models without graying out when the price list fails", async () => {
    vi.mocked(getPricing).mockRejectedValue(new Error('offline'))
    queryClient.setQueryData(['user-models-ccswitch'], {
      success: true,
      data: ['claude-opus-5-5', 'gpt-6.1-sol', 'gemini-4-neon'],
    })
    renderDialog(GPT_KEY, null)

    await waitFor(() => expect(primaryModel()).toHaveValue('claude-opus-5-5'))
    expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked()
    for (const app of ['Claude', 'Codex', 'Gemini', ANTIGRAVITY]) {
      expect(screen.getByRole('radio', { name: app })).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
  })
})

describe('CC Switch link', () => {
  it('opens the CC Switch link with the defaults and records the import for the user', async () => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 7, username: 'cat', role: 1 } as AuthUser)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderDialog(CLAUDE_KEY)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))

    const url = new URL(String(open.mock.calls[0][0]))
    expect(url.searchParams.get('model')).toBe('claude-opus-5-5')
    expect(url.searchParams.get('haikuModel')).toBe('claude-haiku-5-5')
    expect(useOnboardingStore.getState().progress['7']).toEqual({
      ...EMPTY_ONBOARDING_PROGRESS,
      imported: true,
    })
  })

  it('sends Gemini CLI the site root, without a version path', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderDialog(GEMINI_KEY)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))

    const url = new URL(String(open.mock.calls[0][0]))
    expect(url.searchParams.get('app')).toBe('gemini')
    expect(url.searchParams.get('name')).toBe('MeowAPI Gemini')
    expect(url.searchParams.get('endpoint')).toBe(window.location.origin)
    expect(url.searchParams.get('apiKey')).toBe('sk-test-only')
    expect(url.searchParams.get('model')).toBe('gemini-4-neon')
    expect(url.searchParams.get('enabled')).toBe('true')
  })

  it('sends Antigravity as agy in the Gemini format with the High display name and no enable flag', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderDialog(GEMINI_KEY)
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: ANTIGRAVITY }))

    await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))

    const url = new URL(String(open.mock.calls[0][0]))
    expect(url.searchParams.get('app')).toBe('agy')
    expect(url.searchParams.get('name')).toBe('MeowAPI Antigravity')
    expect(url.searchParams.get('endpoint')).toBe(window.location.origin)
    expect(url.searchParams.get('apiKey')).toBe('sk-test-only')
    expect(url.searchParams.get('model')).toBe('Gemini 4 Neon (High)')
    expect(url.searchParams.get('apiFormat')).toBe('gemini_native')
    expect(url.searchParams.has('enabled')).toBe(false)
  })
})

describe('CC Switch model selection', () => {
  it.each([
    ['Claude', 'claude-sonnet-5-5'],
    ['Codex', 'gpt-6-astra'],
    ['Gemini', 'gemini-3.8-flash'],
    [ANTIGRAVITY, 'gemini-3.8-flash'],
  ])(
    'opens %s models outside the clipping dialog and keeps the dialog open after selection',
    async (app, option) => {
      renderDialog(EVERY_FAMILY_KEY)
      const user = userEvent.setup()
      await user.click(screen.getByRole('radio', { name: app }))
      const input = primaryModel()

      await user.click(input)

      expect(input).toHaveAttribute('aria-expanded', 'true')
      const list = await screen.findByRole('listbox')
      const dialog = screen.getByRole('dialog', { name: 'Import to CC Switch' })
      // The dialog is translated and clips overflow. Its popup must escape
      // that containing block to remain aligned and fully visible.
      expect(dialog).not.toContainElement(list)
      await user.click(screen.getByRole('option', { name: option }))
      await waitFor(() => expect(input).toHaveValue(option))
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(dialog).toBeVisible()
    }
  )

  it.each([
    ['Claude', ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']],
    ['Codex', ['gpt-6-astra', 'gpt-6.1-sol']],
    ['Gemini', ['gemini-3.8-flash', 'gemini-4-neon']],
    [ANTIGRAVITY, ['gemini-3.8-flash', 'gemini-4-neon']],
  ])('lists only the models %s can run', async (app, expected) => {
    renderDialog(EVERY_FAMILY_KEY)

    expect((await listedModels(app)).sort()).toEqual(expected)
  })

  it('filters model names and supports keyboard selection and Escape without closing the dialog', async () => {
    renderDialog(CLAUDE_KEY)
    const user = userEvent.setup()
    const input = primaryModel()
    await user.click(input)
    await user.clear(input)
    await user.type(input, 'sonnet')

    expect(
      screen.queryByRole('option', { name: 'claude-opus-5-5' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'claude-sonnet-5-5' })
    ).toBeVisible()
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(input).toHaveValue('claude-sonnet-5-5'))
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('claude-sonnet-5-5')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('shows an empty result while the price list loads and updates an open dropdown when it arrives', async () => {
    vi.mocked(getPricing).mockReturnValue(new Promise(() => {}))
    renderDialog(CLAUDE_KEY, null)
    const user = userEvent.setup()
    const input = primaryModel()
    await user.click(screen.getByRole('button', { name: 'Primary Model' }))

    expect(await screen.findByText('No models found')).toBeVisible()
    await act(async () => {
      queryClient.setQueryData(['pricing'], { success: true, data: PRICING })
    })
    await user.click(
      await screen.findByRole('option', { name: 'claude-sonnet-5-5' })
    )
    await waitFor(() => expect(input).toHaveValue('claude-sonnet-5-5'))
  })

  it('lets users edit the provider name without opening a model dropdown', async () => {
    renderDialog(CLAUDE_KEY)
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'Name' })

    await user.clear(input)
    await user.type(input, 'Development')

    expect(input).toHaveValue('Development')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
