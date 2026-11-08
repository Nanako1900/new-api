import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { useAlertDismissalStore } from '@/stores/alert-dismissal-store'

import { ConsoleAlerts } from '../components/console-alerts'
import { CONSOLE_ALERTS_QUERY_KEY } from '../constants'
import { getAlertDismissKey } from '../lib/dismiss-key'
import type { ConsoleAlert } from '../types'

function makeAlert(overrides: Partial<ConsoleAlert> = {}): ConsoleAlert {
  return {
    id: 1,
    title: 'Maintenance',
    content: 'Requests may **fail** tonight.',
    level: 'warning',
    dismissible: true,
    enabled: true,
    ...overrides,
  }
}

function mockAlerts(alerts: ConsoleAlert[]) {
  return vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: alerts } })
}

function renderAlerts(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  return render(
    <QueryClientProvider client={client}>
      <ConsoleAlerts />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useAlertDismissalStore.setState({ dismissedKeys: [] })
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('a live alert renders its title and Markdown content in a labelled region', async () => {
  mockAlerts([makeAlert()])
  renderAlerts()

  expect(await screen.findByText('Maintenance')).toBeInTheDocument()
  expect(screen.getByText('fail').tagName).toBe('STRONG')
  expect(screen.getByRole('region', { name: 'Site alerts' })).toBeInTheDocument()
})

test('dismissing an alert hides it and persists the dismissal to localStorage', async () => {
  const user = userEvent.setup()
  mockAlerts([makeAlert(), makeAlert({ id: 2, title: 'Second' })])
  const view = renderAlerts()

  const [firstDismiss] = await screen.findAllByRole('button', {
    name: 'Dismiss alert',
  })
  await user.click(firstDismiss)

  expect(screen.queryByText('Maintenance')).not.toBeInTheDocument()
  const stored = JSON.parse(
    localStorage.getItem('console-alert-dismissals') ?? '{}'
  )
  expect(stored.state.dismissedKeys).toEqual([getAlertDismissKey(makeAlert())])

  view.unmount()
  renderAlerts()
  expect(await screen.findByText('Second')).toBeInTheDocument()
  expect(screen.queryByText('Maintenance')).not.toBeInTheDocument()
})

test('a non-dismissible alert has no dismiss button', async () => {
  mockAlerts([makeAlert({ dismissible: false })])
  renderAlerts()

  expect(await screen.findByText('Maintenance')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Dismiss alert' })
  ).not.toBeInTheDocument()
})

test('a dismissed alert shows again after its content is edited', async () => {
  useAlertDismissalStore.setState({
    dismissedKeys: [getAlertDismissKey(makeAlert())],
  })
  mockAlerts([makeAlert({ content: 'Maintenance moved to Saturday.' })])
  renderAlerts()

  expect(
    await screen.findByText('Maintenance moved to Saturday.')
  ).toBeInTheDocument()
})

test('a dismissed alert stays hidden when only its schedule changes', async () => {
  useAlertDismissalStore.setState({
    dismissedKeys: [getAlertDismissKey(makeAlert())],
  })
  mockAlerts([
    makeAlert({ endsAt: '2099-01-01T00:00:00Z' }),
    makeAlert({ id: 2, title: 'Second' }),
  ])
  renderAlerts()

  expect(await screen.findByText('Second')).toBeInTheDocument()
  expect(screen.queryByText('Maintenance')).not.toBeInTheDocument()
})

test('dismissals of alerts that are no longer live are pruned', async () => {
  const liveKey = getAlertDismissKey(makeAlert())
  useAlertDismissalStore.setState({ dismissedKeys: ['99:gone', liveKey] })
  mockAlerts([makeAlert(), makeAlert({ id: 2, title: 'Second' })])
  renderAlerts()

  expect(await screen.findByText('Second')).toBeInTheDocument()
  await waitFor(() =>
    expect(useAlertDismissalStore.getState().dismissedKeys).toEqual([liveKey])
  )
})

test('a dismissal made in another tab hides the alert in this tab', async () => {
  mockAlerts([makeAlert(), makeAlert({ id: 2, title: 'Second' })])
  renderAlerts()
  expect(await screen.findByText('Maintenance')).toBeInTheDocument()

  localStorage.setItem(
    'console-alert-dismissals',
    JSON.stringify({
      state: { dismissedKeys: [getAlertDismissKey(makeAlert())] },
      version: 0,
    })
  )
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'console-alert-dismissals' })
  )

  await waitFor(() =>
    expect(screen.queryByText('Maintenance')).not.toBeInTheDocument()
  )
  expect(screen.getByText('Second')).toBeInTheDocument()
})

test('a failed request renders nothing and shows no error toast', async () => {
  const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('Network Error'))
  const toastError = vi.spyOn(toast, 'error')
  const client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
  })
  const view = renderAlerts(client)

  await waitFor(() => expect(get).toHaveBeenCalled())
  await waitFor(() =>
    expect(client.getQueryState(CONSOLE_ALERTS_QUERY_KEY)?.status).toBe(
      'error'
    )
  )
  expect(view.container).toBeEmptyDOMElement()
  expect(toastError).not.toHaveBeenCalled()
})
