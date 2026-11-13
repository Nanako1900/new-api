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

import { useAuthStore, type AuthUser } from '@/stores/auth-store'
import {
  EMPTY_ONBOARDING_PROGRESS,
  useOnboardingStore,
} from '@/stores/onboarding-store'

import { CCSwitchDialog } from '../cc-switch-dialog'

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
})

function renderDialog(
  models = ['gpt-5.4', 'gpt-5.5', 'claude-sonnet-4-6', 'claude-opus-4-6']
) {
  queryClient.setQueryData(['user-models-ccswitch'], {
    success: true,
    data: models,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <CCSwitchDialog open onOpenChange={vi.fn()} tokenKey='test-only' />
    </QueryClientProvider>
  )
}

const SITE_MODELS = [
  'claude-haiku-5-5',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'gpt-6-astra',
  'gpt-6.1-sol',
]

describe('CC Switch defaults', () => {
  it('fills every Claude field with a default when the dialog opens', () => {
    renderDialog(SITE_MODELS)

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'MeowAPI Claude'
    )
    expect(screen.getByRole('combobox', { name: 'Primary Model' })).toHaveValue(
      'claude-opus-5-5'
    )
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

  it('switches the name and model to Codex defaults when Codex is picked', async () => {
    renderDialog(SITE_MODELS)
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: 'Codex' }))

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'MeowAPI Codex'
    )
    expect(screen.getByRole('combobox', { name: 'Primary Model' })).toHaveValue(
      'gpt-6.1-sol'
    )
  })

  it('offers Claude and Codex only', () => {
    renderDialog(SITE_MODELS)

    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Claude' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeVisible()
    expect(
      screen.queryByRole('radio', { name: 'Gemini' })
    ).not.toBeInTheDocument()
  })

  it('opens the CC Switch link with the defaults and records the import for the user', async () => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 7, username: 'cat', role: 1 } as AuthUser)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderDialog(SITE_MODELS)
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
})

describe('CC Switch model selection', () => {
  it.each([
    ['Claude', 'claude-sonnet-4-6'],
    ['Codex', 'gpt-5.4'],
  ])(
    'opens %s models outside the clipping dialog and keeps the dialog open after selection',
    async (app, option) => {
      renderDialog()
      const user = userEvent.setup()
      await user.click(screen.getByRole('radio', { name: app }))
      const input = screen.getByRole('combobox', { name: 'Primary Model' })

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
    ['Claude', ['claude-opus-4-6', 'claude-sonnet-4-6']],
    ['Codex', ['gpt-5.4', 'gpt-5.5']],
  ])('lists only the models %s can run', async (app, expected) => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: app }))
    const input = screen.getByRole('combobox', { name: 'Primary Model' })

    await user.click(input)
    await screen.findByRole('listbox')

    expect(
      screen
        .getAllByRole('option')
        .map((option) => option.textContent)
        .sort()
    ).toEqual(expected)
  })

  it('filters model names and supports keyboard selection and Escape without closing the dialog', async () => {
    renderDialog()
    const user = userEvent.setup()
    const input = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(input)
    await user.type(input, 'sonnet')

    expect(
      screen.queryByRole('option', { name: 'claude-opus-4-6' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'claude-sonnet-4-6' })
    ).toBeVisible()
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(input).toHaveValue('claude-sonnet-4-6'))
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('claude-sonnet-4-6')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('shows an empty result when no models are available and updates an open dropdown when models arrive', async () => {
    renderDialog([])
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Codex' }))
    const input = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(screen.getByRole('button', { name: 'Primary Model' }))

    expect(await screen.findByText('No models found')).toBeVisible()
    await act(async () => {
      queryClient.setQueryData(['user-models-ccswitch'], {
        success: true,
        data: ['gpt-5.4'],
      })
    })
    await user.click(await screen.findByRole('option', { name: 'gpt-5.4' }))
    await waitFor(() => expect(input).toHaveValue('gpt-5.4'))
  })

  it('lets users edit the provider name without opening a model dropdown', async () => {
    renderDialog()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'Name' })

    await user.clear(input)
    await user.type(input, 'Development')

    expect(input).toHaveValue('Development')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
