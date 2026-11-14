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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore, type AuthUser } from '@/stores/auth-store'
import {
  EMPTY_ONBOARDING_PROGRESS,
  useOnboardingStore,
} from '@/stores/onboarding-store'

import { OnboardingTour } from '../onboarding-tour'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouterState: (options: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => options.select({ location: { pathname: '/dashboard/overview' } }),
  useNavigate: () => vi.fn(),
}))

const originalMatchMedia = window.matchMedia

/** Makes the screen report the given width to `min-width` queries. */
function setScreenWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const minWidth = /min-width:\s*(\d+)px/.exec(query)
      return {
        ...originalMatchMedia(query),
        matches: minWidth ? width >= Number(minWidth[1]) : false,
      }
    },
  })
}

beforeEach(() => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 7, username: 'cat', role: 1 } as AuthUser)
})

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
  useAuthStore.getState().auth.setUser(null)
  useOnboardingStore.setState({ progress: {}, run: null })
})

describe('OnboardingTour', () => {
  it('opens the welcome card by itself on a wide screen and remembers it was shown', async () => {
    setScreenWidth(1280)
    render(<OnboardingTour />)

    expect(
      await screen.findByRole('heading', { name: 'Welcome to MeowAPI' })
    ).toBeVisible()
    expect(useOnboardingStore.getState().progress['7'].seen).toBe(true)
  })

  it('does not open by itself on a narrow screen', async () => {
    setScreenWidth(390)
    render(<OnboardingTour />)

    await waitFor(() => expect(useOnboardingStore.getState().run).toBeNull())
    expect(
      screen.queryByRole('heading', { name: 'Welcome to MeowAPI' })
    ).not.toBeInTheDocument()
  })

  it('does not open by itself again once the user has seen it', async () => {
    setScreenWidth(1280)
    useOnboardingStore.setState({
      progress: { '7': { ...EMPTY_ONBOARDING_PROGRESS, seen: true } },
    })
    render(<OnboardingTour />)

    await waitFor(() => expect(useOnboardingStore.getState().run).toBeNull())
  })

  it('asks before skipping, says where to find the guide again and ends the tour on confirm', async () => {
    setScreenWidth(1280)
    render(<OnboardingTour />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Skip' }))
    const confirm = await screen.findByRole('alertdialog')

    expect(confirm).toHaveTextContent(
      'Getting started at the bottom of the left sidebar'
    )
    await user.click(within(confirm).getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(useOnboardingStore.getState().run).toBeNull())
  })

  it('keeps the tour running when the user decides to keep going', async () => {
    setScreenWidth(1280)
    render(<OnboardingTour />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Skip' }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(
      within(confirm).getByRole('button', { name: 'Keep going' })
    )

    expect(
      await screen.findByRole('heading', { name: 'Welcome to MeowAPI' })
    ).toBeVisible()
    expect(useOnboardingStore.getState().run).not.toBeNull()
  })

  it('tells the user on the last card where to open the guide again', async () => {
    useOnboardingStore.setState({
      run: {
        userId: 7,
        welcomed: true,
        installed: true,
        pickedApp: true,
        imported: true,
      },
    })
    render(<OnboardingTour />)

    const card = await screen.findByRole('dialog', { name: 'Getting started' })
    expect(card).toHaveTextContent('Last step, in CC Switch')
    expect(card).toHaveTextContent(
      'Want to see this again? Click Getting started at the bottom left.'
    )
  })

  describe('in the key drawer', () => {
    const originalRect = Element.prototype.getBoundingClientRect

    beforeEach(() => {
      // jsdom lays nothing out: give elements a box so the tour finds the
      // fields it points at.
      Element.prototype.getBoundingClientRect = () =>
        ({
          top: 40,
          left: 40,
          width: 200,
          height: 32,
          right: 240,
          bottom: 72,
          x: 40,
          y: 40,
          toJSON: () => ({}),
        }) as DOMRect
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="key-drawer">
          <div data-tour="key-name"><input aria-label="Name" /></div>
          <div data-tour="key-group" data-group-picked="false">
            <button role="combobox">Select a group</button>
          </div>
          <button data-tour="save-key">Save changes</button>
        </div>`
      )
      useOnboardingStore.setState({
        run: {
          userId: 7,
          welcomed: true,
          installed: true,
          pickedApp: false,
          imported: false,
        },
      })
    })

    afterEach(() => {
      Element.prototype.getBoundingClientRect = originalRect
      document.querySelector('#key-drawer')?.remove()
    })

    it('keeps asking for a name and focuses the field when Next is clicked with no name', async () => {
      render(<OnboardingTour />)
      const user = userEvent.setup()

      await user.click(await screen.findByRole('button', { name: 'Next' }))

      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()
      expect(
        screen.getByRole('heading', { name: 'Name your key' })
      ).toBeVisible()
    })

    it('waits while the user types and moves to the group after Next', async () => {
      render(<OnboardingTour />)
      const user = userEvent.setup()

      await user.type(
        await screen.findByRole('textbox', { name: 'Name' }),
        'laptop'
      )
      expect(
        screen.getByRole('heading', { name: 'Name your key' })
      ).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Next' }))

      expect(screen.getByRole('combobox')).toHaveFocus()
      expect(
        await screen.findByRole('heading', { name: 'Pick a group' })
      ).toBeVisible()
    })
  })

  it('moves from the welcome card to the install card and records the install', async () => {
    setScreenWidth(1280)
    render(<OnboardingTour />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await user.click(
      await screen.findByRole('button', { name: 'Already installed' })
    )

    expect(useOnboardingStore.getState().progress['7'].installed).toBe(true)
    expect(useOnboardingStore.getState().run?.installed).toBe(true)
    expect(
      await screen.findByRole('heading', { name: 'Open API Keys' })
    ).toBeVisible()
  })
})
