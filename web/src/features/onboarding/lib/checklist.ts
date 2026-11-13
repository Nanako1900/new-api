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
import type { TourStart } from '@/stores/onboarding-store'

export type ChecklistItemId = 'install' | 'create-key' | 'import' | 'first-call'

export type ChecklistItem = {
  id: ChecklistItemId
  done: boolean
  /** Where the tour starts to help with this item; none for the first call. */
  tourStart?: TourStart
}

/**
 * The getting-started checklist. A user who already made a request got set
 * up some other way, so every item counts as done; importing into CC Switch
 * also proves it is installed.
 */
export function gettingStartedChecklist(input: {
  installed: boolean
  imported: boolean
  hasKeys: boolean
  requestCount: number
}): ChecklistItem[] {
  const called = input.requestCount > 0
  return [
    {
      id: 'install',
      done: called || input.installed || input.imported,
      tourStart: 'install',
    },
    { id: 'create-key', done: called || input.hasKeys, tourStart: 'keys' },
    { id: 'import', done: called || input.imported, tourStart: 'keys' },
    { id: 'first-call', done: called },
  ]
}
