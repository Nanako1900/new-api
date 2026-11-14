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
import { afterEach, describe, expect, it } from 'vitest'

import {
  currentTourStep,
  placeTourBubble,
  readTourPage,
  type TourPage,
} from '../tour'

const PASSED_CARDS = {
  welcomed: true,
  installed: true,
  pickedApp: false,
  imported: false,
}

const ON_KEYS_PAGE: TourPage = {
  onKeysPage: true,
  keyCount: 0,
  keyFormOpen: false,
  keyNamed: false,
  keyGroupPicked: false,
  groupListOpen: false,
  ccSwitchOpen: false,
}

const DRAWER_OPEN: TourPage = { ...ON_KEYS_PAGE, keyFormOpen: true }

describe('currentTourStep', () => {
  it('starts with the welcome card and then the install card', () => {
    expect(
      currentTourStep(
        { ...PASSED_CARDS, welcomed: false, installed: false },
        ON_KEYS_PAGE
      )
    ).toBe('welcome')
    expect(
      currentTourStep({ ...PASSED_CARDS, installed: false }, ON_KEYS_PAGE)
    ).toBe('install')
  })

  it('points at the sidebar while the user is on another page', () => {
    expect(
      currentTourStep(PASSED_CARDS, { ...ON_KEYS_PAGE, onKeysPage: false })
    ).toBe('open-keys')
  })

  it('waits while the key list is loading', () => {
    expect(
      currentTourStep(PASSED_CARDS, { ...ON_KEYS_PAGE, keyCount: null })
    ).toBeNull()
  })

  it('asks for a new key when the user has none and skips it when one exists', () => {
    expect(currentTourStep(PASSED_CARDS, ON_KEYS_PAGE)).toBe('create-key')
    expect(
      currentTourStep(PASSED_CARDS, { ...ON_KEYS_PAGE, keyCount: 2 })
    ).toBe('open-cc-switch')
  })

  it('asks for a name first when the key drawer opens', () => {
    expect(currentTourStep(PASSED_CARDS, DRAWER_OPEN)).toBe('name-key')
  })

  it('asks for a group once the key is named and none is picked', () => {
    expect(
      currentTourStep(PASSED_CARDS, { ...DRAWER_OPEN, keyNamed: true })
    ).toBe('pick-group')
  })

  it('points at Save only when the key has a name and a group', () => {
    const named = { ...DRAWER_OPEN, keyNamed: true, keyGroupPicked: true }
    expect(currentTourStep(PASSED_CARDS, named)).toBe('save-key')
    expect(currentTourStep(PASSED_CARDS, { ...named, keyNamed: false })).toBe(
      'name-key'
    )
  })

  it('steps aside while the group list is open and comes back when it closes', () => {
    const naming = { ...DRAWER_OPEN, keyNamed: true }
    expect(
      currentTourStep(PASSED_CARDS, { ...naming, groupListOpen: true })
    ).toBeNull()
    expect(currentTourStep(PASSED_CARDS, naming)).toBe('pick-group')
  })

  it('goes back to Create when the drawer closes without a new key', () => {
    expect(currentTourStep(PASSED_CARDS, DRAWER_OPEN)).toBe('name-key')
    expect(
      currentTourStep(PASSED_CARDS, { ...DRAWER_OPEN, keyFormOpen: false })
    ).toBe('create-key')
  })

  it('shows the app hint, then the open button, inside the CC Switch dialog', () => {
    const page = { ...ON_KEYS_PAGE, keyCount: 1, ccSwitchOpen: true }
    expect(currentTourStep(PASSED_CARDS, page)).toBe('pick-app')
    expect(currentTourStep({ ...PASSED_CARDS, pickedApp: true }, page)).toBe(
      'import'
    )
  })

  it('ends on the CC Switch card once the user opened CC Switch', () => {
    expect(
      currentTourStep(
        { ...PASSED_CARDS, imported: true },
        { ...ON_KEYS_PAGE, onKeysPage: false }
      )
    ).toBe('done')
  })
})

describe('placeTourBubble', () => {
  const bubble = { width: 300, height: 160 }
  const viewport = { width: 1280, height: 800 }

  it('centres the bubble when nothing is highlighted', () => {
    expect(placeTourBubble(null, bubble, viewport)).toEqual({
      top: 320,
      left: 490,
    })
  })

  it('puts the bubble right of a sidebar link', () => {
    const link = { top: 220, left: 16, width: 200, height: 32 }

    expect(placeTourBubble(link, bubble, viewport)).toEqual({
      top: 156,
      left: 230,
    })
  })

  it('drops below a button at the right edge and stays inside the window', () => {
    const button = { top: 170, left: 1150, width: 110, height: 32 }

    expect(placeTourBubble(button, bubble, viewport)).toEqual({
      top: 216,
      left: 964,
    })
  })

  it('goes above a button at the bottom right corner', () => {
    const save = { top: 740, left: 1150, width: 110, height: 36 }

    expect(placeTourBubble(save, bubble, viewport)).toEqual({
      top: 566,
      left: 964,
    })
  })
})

describe('readTourPage', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reads the loaded key count and open dialogs from the page', () => {
    document.body.innerHTML = `
      <div data-tour="key-list" data-key-count="3"></div>
      <button data-tour="cc-switch-open"></button>`

    expect(readTourPage('/keys')).toEqual({
      onKeysPage: true,
      keyCount: 3,
      keyFormOpen: false,
      keyNamed: false,
      keyGroupPicked: false,
      groupListOpen: false,
      ccSwitchOpen: true,
    })
  })

  it('reads the group list as open from the expanded group field', () => {
    document.body.innerHTML = `
      <div data-tour="key-group">
        <button role="combobox" aria-expanded="true"></button>
      </div>`

    expect(readTourPage('/keys').groupListOpen).toBe(true)
  })

  it('counts the key as named only after the user leaves the filled name field', () => {
    document.body.innerHTML = `
      <div data-tour="key-name"><input value="laptop" /></div>
      <button data-tour="save-key"></button>`
    const input = document.querySelector('input')
    if (!input) throw new Error('Expected the name input')

    input.focus()
    expect(readTourPage('/keys').keyNamed).toBe(false)
    input.blur()
    expect(readTourPage('/keys').keyNamed).toBe(true)
  })

  it('does not count a blank name as named', () => {
    document.body.innerHTML = `<div data-tour="key-name"><input value="  " /></div>`

    expect(readTourPage('/keys').keyNamed).toBe(false)
  })

  it('reads whether the group field reports a picked group', () => {
    document.body.innerHTML = `<div data-tour="key-group" data-group-picked="false"></div>`
    expect(readTourPage('/keys').keyGroupPicked).toBe(false)

    document.body.innerHTML = `<div data-tour="key-group" data-group-picked="true"></div>`
    expect(readTourPage('/keys').keyGroupPicked).toBe(true)
  })

  it('reports no key count while the list has not loaded', () => {
    document.body.innerHTML = '<div data-tour="key-list"></div>'

    expect(readTourPage('/dashboard/overview')).toMatchObject({
      onKeysPage: false,
      keyCount: null,
    })
  })
})
