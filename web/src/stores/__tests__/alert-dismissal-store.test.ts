import { beforeEach, expect, test } from 'vitest'

import { useAlertDismissalStore } from '../alert-dismissal-store'

const STORAGE_KEY = 'console-alert-dismissals'

function writeFromAnotherTab(dismissedKeys: unknown) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state: { dismissedKeys }, version: 0 })
  )
}

function storedKeys(): unknown {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').state
    ?.dismissedKeys
}

beforeEach(() => {
  useAlertDismissalStore.setState({ dismissedKeys: [] })
  localStorage.clear()
})

test('pruning with nothing to remove leaves dismissals stored by another tab', () => {
  writeFromAnotherTab(['1:a'])

  useAlertDismissalStore.getState().prune(['1:a', '2:b'])

  expect(storedKeys()).toEqual(['1:a'])
})

test('pruning keeps only the keys of live alert versions', () => {
  useAlertDismissalStore.setState({ dismissedKeys: ['1:old', '1:new', '2:x'] })

  useAlertDismissalStore.getState().prune(['1:new'])

  expect(useAlertDismissalStore.getState().dismissedKeys).toEqual(['1:new'])
  expect(storedKeys()).toEqual(['1:new'])
})

test('rehydrating loads the dismissals another tab stored', async () => {
  writeFromAnotherTab(['1:a'])

  await useAlertDismissalStore.persist.rehydrate()

  expect(useAlertDismissalStore.getState().dismissedKeys).toEqual(['1:a'])
})

test.each([[null], ['oops'], [[1, '1:a']]])(
  'a malformed stored value %j hydrates as an empty list',
  async (value) => {
    useAlertDismissalStore.setState({ dismissedKeys: ['9:z'] })
    writeFromAnotherTab(value)

    await useAlertDismissalStore.persist.rehydrate()

    expect(useAlertDismissalStore.getState().dismissedKeys).toEqual([])
  }
)
