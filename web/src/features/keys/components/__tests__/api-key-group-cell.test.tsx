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
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { ApiKeyGroupCell } = await import('../api-key-group-cell')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Auto: 'Auto',
        'Cross-group': 'Cross-group',
        Ratio: 'Ratio',
        'Automatically selects the best available group with circuit breaker mechanism':
          'Automatically selects the best available group with circuit breaker mechanism',
      },
    },
  },
})

function CellHarness(props: {
  group: string
  ratio?: number | string
  crossGroupRetry?: boolean
  shouldReduceMotion?: boolean
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <ApiKeyGroupCell
          group={props.group}
          ratio={props.ratio}
          crossGroupRetry={props.crossGroupRetry ?? false}
          shouldReduceMotion={props.shouldReduceMotion ?? false}
        />
      </TooltipProvider>
    </I18nextProvider>
  )
}

describe('API key group table cell', () => {
  test('keeps the group and compact localized multiplier together with one subtle flowing edge', () => {
    const { container } = render(
      <CellHarness group='auto' ratio='自动' crossGroupRetry />
    )
    const group = screen.getByText('Cross-group')
    const multiplier = screen
      .getByText('Auto')
      .closest<HTMLElement>('[data-slot="badge"]')
    expect(group).toBeInTheDocument()
    expect(multiplier).toHaveClass('h-5', 'min-w-12', 'rounded-md')
    expect(multiplier).not.toHaveTextContent('Ratio')
    expect(container).not.toHaveTextContent('自动')
    expect(container.querySelector('[data-auto-group-frame]')).toBeNull()
    const flow = container.querySelector('[data-auto-group-flow-border]')
    expect(flow).toHaveClass('auto-group-flow-border-subtle')
    expect(flow).toHaveAttribute('aria-hidden', 'true')
    expect(group.closest('[data-api-key-group-cell]')).toContainElement(
      multiplier
    )
  })

  test('keeps the automatic tag visible but static when reduced motion is requested', () => {
    const { container } = render(
      <CellHarness group='auto' ratio='Auto' shouldReduceMotion />
    )
    expect(screen.getByText('Auto')).toBeInTheDocument()
    expect(container.querySelector('[data-auto-group-flow-border]')).toBeNull()
  })

  test('does not invent a multiplier while automatic ratio data is unavailable', () => {
    render(<CellHarness group='auto' />)
    expect(screen.getByText('Cross-group')).toBeInTheDocument()
    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
  })

  test.each([0, 0.8, 1, 3])(
    'hides internal coefficient %s when no comparison is available',
    (ratio) => {
      render(<CellHarness group='default' ratio={ratio} />)
      expect(screen.getByText('default')).toBeInTheDocument()
      expect(screen.queryByText(`${ratio}x`)).not.toBeInTheDocument()
    }
  )

  test('labels the user group multiplier as inherited without inventing a numeric value', async () => {
    render(<CellHarness group='' />)
    expect(screen.getByText('User Group')).toBeInTheDocument()
    expect(screen.getByText('Inherited')).toBeInTheDocument()
    expect(screen.getByText('Inherited').parentElement).toHaveClass(
      'border-muted-foreground/30',
      'rounded-full'
    )
    expect(screen.queryByText('1x')).not.toBeInTheDocument()
    await userEvent.tab()
    expect(await screen.findByText('Follow user group')).toBeVisible()
  })

  test('keeps a long group name available through keyboard focus without an internal coefficient', async () => {
    const groupName = 'production-with-a-very-long-custom-group-name'
    render(<CellHarness group={groupName} ratio={12.345678} />)
    expect(
      screen.getByText(groupName).closest('[data-slot="tooltip-trigger"]')
    ).toHaveClass('max-w-50')
    expect(screen.queryByText('12.345678x')).not.toBeInTheDocument()
    await userEvent.tab()
    expect(
      await screen.findByText(groupName, {
        selector: '[data-slot="tooltip-content"]',
      })
    ).toBeVisible()
  })

  test('never turns a string-valued normal group ratio into an automatic multiplier', () => {
    render(<CellHarness group='vip' ratio='自动' />)
    expect(screen.getByText('vip')).toBeInTheDocument()
    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
    expect(screen.queryByText('自动')).not.toBeInTheDocument()
  })
})
