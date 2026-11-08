import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { AlertsSection } from '../alerts-section'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useBlocker: () => ({ status: 'idle', proceed: vi.fn(), reset: vi.fn() }),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function makeAlerts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    content: `Alert ${index + 1}`,
    level: 'info',
    dismissible: true,
    enabled: true,
  }))
}

function renderSection(alerts: unknown[]) {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, message: '' } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AlertsSection data={JSON.stringify(alerts)} />
    </QueryClientProvider>
  )
  return { put }
}

test('adding an alert saves trimmed content with id 1 and omits empty optional fields', async () => {
  const user = userEvent.setup()
  const { put } = renderSection([])

  await user.click(screen.getByRole('button', { name: /Add Alert/ }))
  await user.type(screen.getByLabelText('Content'), '  Maintenance tonight  ')
  await user.click(screen.getByRole('button', { name: 'Add' }))
  await user.click(screen.getByRole('button', { name: /Save Settings/ }))

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'console_setting.alerts',
      value:
        '[{"id":1,"content":"Maintenance tonight","level":"info","dismissible":true,"enabled":true}]',
    })
  )
})

test('editing an alert keeps its id when saved', async () => {
  const user = userEvent.setup()
  const { put } = renderSection(makeAlerts(2))

  const row = screen.getByText('Alert 1').closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Edit' }))
  const content = screen.getByLabelText('Content')
  await user.clear(content)
  await user.type(content, 'Updated one')
  await user.click(screen.getByRole('button', { name: 'Update' }))
  await user.click(screen.getByRole('button', { name: /Save Settings/ }))

  await waitFor(() => expect(put).toHaveBeenCalled())
  const saved = JSON.parse((put.mock.calls[0][1] as { value: string }).value)
  expect(saved.map((alert: { id: number }) => alert.id)).toEqual([1, 2])
  expect(saved[0].content).toBe('Updated one')
  expect(saved[1].content).toBe('Alert 2')
})

test('deleting an alert after confirmation removes it from the saved list', async () => {
  const user = userEvent.setup()
  const { put } = renderSection(makeAlerts(2))

  const row = screen.getByText('Alert 1').closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Open menu' }))
  await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: /Save Settings/ }))

  await waitFor(() => expect(put).toHaveBeenCalled())
  const saved = JSON.parse((put.mock.calls[0][1] as { value: string }).value)
  expect(saved).toHaveLength(1)
  expect(saved[0].id).toBe(2)
})

test('the Add Alert button is disabled when 20 alerts already exist', () => {
  renderSection(makeAlerts(20))

  expect(screen.getByRole('button', { name: /Add Alert/ })).toBeDisabled()
})

test('Save Settings is disabled until something changes', () => {
  renderSection(makeAlerts(1))

  expect(screen.getByRole('button', { name: /Save Settings/ })).toBeDisabled()
})

function savedAlerts(put: ReturnType<typeof vi.spyOn>) {
  return JSON.parse((put.mock.calls[0][1] as { value: string }).value)
}

test('selection checkboxes have accessible names', () => {
  renderSection(makeAlerts(3))

  expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeVisible()
  expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(
    3
  )
})

test('batch deleting selected rows saves only the remaining alert', async () => {
  const user = userEvent.setup()
  const { put } = renderSection(makeAlerts(3))

  const rows = screen.getAllByRole('checkbox', { name: 'Select row' })
  await user.click(rows[0])
  await user.click(rows[1])
  await user.click(screen.getByRole('button', { name: /Delete selected/ }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: /Save Settings/ }))

  await waitFor(() => expect(put).toHaveBeenCalled())
  expect(savedAlerts(put).map((alert: { id: number }) => alert.id)).toEqual([1])
})

test('a failed save keeps the local edits and leaves Save Settings enabled', async () => {
  const user = userEvent.setup()
  const { put } = renderSection([])
  put.mockResolvedValue({
    data: {
      success: false,
      message: 'Alert #{{index}} has an invalid level value',
    },
  })

  await user.click(screen.getByRole('button', { name: /Add Alert/ }))
  await user.type(screen.getByLabelText('Content'), 'Keep me')
  await user.click(screen.getByRole('button', { name: 'Add' }))
  await user.click(screen.getByRole('button', { name: /Save Settings/ }))

  await waitFor(() => expect(put).toHaveBeenCalled())
  expect(screen.getByText('Keep me')).toBeVisible()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save Settings/ })).toBeEnabled()
  )
})

test('editing only the content keeps the schedule strings unchanged', async () => {
  const user = userEvent.setup()
  const { put } = renderSection([
    {
      ...makeAlerts(1)[0],
      startsAt: '2026-11-07T20:00:00.000Z',
      endsAt: '2026-11-08T20:00:00.000Z',
    },
  ])

  const row = screen.getByText('Alert 1').closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Edit' }))
  const content = screen.getByLabelText('Content')
  await user.clear(content)
  await user.type(content, 'Edited')
  await user.click(screen.getByRole('button', { name: 'Update' }))
  await user.click(screen.getByRole('button', { name: /Save Settings/ }))

  await waitFor(() => expect(put).toHaveBeenCalled())
  const saved = savedAlerts(put)[0]
  expect(saved.startsAt).toBe('2026-11-07T20:00:00.000Z')
  expect(saved.endsAt).toBe('2026-11-08T20:00:00.000Z')
})

test('stored data with an unknown level and a null item still renders the valid alert', () => {
  renderSection([
    null,
    {
      id: 5,
      content: 'Broken',
      level: 'fatal',
      dismissible: true,
      enabled: true,
    },
    makeAlerts(1)[0],
  ])

  expect(screen.getByText('Alert 1')).toBeVisible()
  expect(screen.queryByText('Broken')).not.toBeInTheDocument()
})
