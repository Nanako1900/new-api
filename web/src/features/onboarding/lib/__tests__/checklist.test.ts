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
import { describe, expect, it } from 'vitest'

import { gettingStartedChecklist } from '../checklist'

const NEW_USER = {
  installed: false,
  imported: false,
  hasKeys: false,
  requestCount: 0,
}

function doneIds(input: typeof NEW_USER) {
  return gettingStartedChecklist(input)
    .filter((item) => item.done)
    .map((item) => item.id)
}

describe('gettingStartedChecklist', () => {
  it('leaves every item open for a new user', () => {
    expect(doneIds(NEW_USER)).toEqual([])
  })

  it('ticks items one by one as the user installs, creates a key and imports', () => {
    expect(doneIds({ ...NEW_USER, installed: true })).toEqual(['install'])
    expect(doneIds({ ...NEW_USER, installed: true, hasKeys: true })).toEqual([
      'install',
      'create-key',
    ])
    expect(
      doneIds({ ...NEW_USER, installed: true, hasKeys: true, imported: true })
    ).toEqual(['install', 'create-key', 'import'])
  })

  it('counts CC Switch as installed once a key was imported', () => {
    expect(doneIds({ ...NEW_USER, imported: true })).toContain('install')
  })

  it('marks everything done for a user who already made a request', () => {
    expect(doneIds({ ...NEW_USER, requestCount: 12 })).toEqual([
      'install',
      'create-key',
      'import',
      'first-call',
    ])
  })
})
