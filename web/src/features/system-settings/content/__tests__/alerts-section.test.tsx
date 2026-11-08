import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { AlertsSection } from '../alerts-section'

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
