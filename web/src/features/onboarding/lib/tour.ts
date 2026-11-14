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
import type { TourRun } from '@/stores/onboarding-store'

/** The official CC Switch site, which links the downloads. */
export const CC_SWITCH_DOWNLOAD_URL = 'https://ccswitch.io/'

/** The page the tour sends users to for their keys. */
export const KEYS_PATH = '/keys'

/** The tour's steps, in the order a new user meets them. */
export const TOUR_STEPS = [
  'welcome',
  'install',
  'open-keys',
  'create-key',
  'name-key',
  'pick-group',
  'save-key',
  'open-cc-switch',
  'pick-app',
  'import',
  'done',
] as const

export type TourStepId = (typeof TOUR_STEPS)[number]

// Their presence tells the tour that the key drawer or the CC Switch dialog
// is open.
const SAVE_KEY_TARGET = '[data-tour="save-key"]'
const CC_SWITCH_OPEN_TARGET = '[data-tour="cc-switch-open"]'

// The name and group fields of the key drawer. The group field says through
// `data-group-picked` whether one of the user's groups is chosen.
const KEY_NAME_TARGET = '[data-tour="key-name"]'
const KEY_GROUP_TARGET = '[data-tour="key-group"]'
export const KEY_NAME_INPUT = `${KEY_NAME_TARGET} input`
export const KEY_GROUP_TRIGGER = `${KEY_GROUP_TARGET} button[role="combobox"]`

/**
 * The element each pointing step highlights. Steps without one are cards
 * in the middle of the screen.
 */
export const TOUR_TARGETS: Partial<Record<TourStepId, string>> = {
  'open-keys': `[data-sidebar="sidebar"] a[href="${KEYS_PATH}"]`,
  'create-key': '[data-tour="create-key"]',
  'name-key': KEY_NAME_TARGET,
  'pick-group': KEY_GROUP_TARGET,
  'save-key': SAVE_KEY_TARGET,
  'open-cc-switch': '[data-tour="key-cc-switch"]',
  // The whole form, so the user can switch the tool and change models.
  'pick-app': '[data-tour="cc-switch-form"]',
  import: CC_SWITCH_OPEN_TARGET,
}

/**
 * Steps that point inside an open drawer or dialog. Their layer sits at the
 * dialog's level rather than above everything, so a dropdown opened from the
 * highlighted form (a model list) shows above the dimmed area.
 */
export const DIALOG_STEPS: ReadonlySet<TourStepId> = new Set([
  'name-key',
  'pick-group',
  'save-key',
  'pick-app',
  'import',
])

/** A box on screen, in viewport pixels. */
export type TourRect = {
  top: number
  left: number
  width: number
  height: number
}

type Size = { width: number; height: number }

// Space between the highlighted element and the bubble, and the least
// distance the bubble keeps from the window edges.
const BUBBLE_GAP = 14
const VIEWPORT_MARGIN = 16

/**
 * Where the guide bubble goes: beside the highlighted element (right, then
 * below, above or left, whichever fits first), kept inside the window. With
 * no element it sits in the middle of the window.
 */
export function placeTourBubble(
  target: TourRect | null,
  bubble: Size,
  viewport: Size
): { top: number; left: number } {
  const maxTop = viewport.height - bubble.height - VIEWPORT_MARGIN
  const maxLeft = viewport.width - bubble.width - VIEWPORT_MARGIN
  const clampTop = (top: number) =>
    Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))
  const clampLeft = (left: number) =>
    Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))

  if (!target) {
    return {
      top: clampTop((viewport.height - bubble.height) / 2),
      left: clampLeft((viewport.width - bubble.width) / 2),
    }
  }

  const middleTop = clampTop(target.top + (target.height - bubble.height) / 2)
  const centerLeft = clampLeft(target.left + (target.width - bubble.width) / 2)
  const right = target.left + target.width + BUBBLE_GAP
  if (right <= maxLeft) return { top: middleTop, left: right }
  const below = target.top + target.height + BUBBLE_GAP
  if (below <= maxTop) return { top: below, left: centerLeft }
  const above = target.top - BUBBLE_GAP - bubble.height
  if (above >= VIEWPORT_MARGIN) return { top: above, left: centerLeft }
  const left = target.left - BUBBLE_GAP - bubble.width
  if (left >= VIEWPORT_MARGIN) return { top: middleTop, left }
  return { top: clampTop(below), left: centerLeft }
}

/** What the tour reads from the page to decide where the user is. */
export type TourPage = {
  onKeysPage: boolean
  /** Keys in the list, or null while the list loads or is not shown. */
  keyCount: number | null
  keyFormOpen: boolean
  /**
   * The new key has a name and the user left the name field, so the tour
   * does not move on while they are still typing.
   */
  keyNamed: boolean
  /** One of the user's groups is chosen for the new key. */
  keyGroupPicked: boolean
  /**
   * The group list is open. It opens inside the drawer's layer, which the
   * tour covers, so the tour steps aside until it closes.
   */
  groupListOpen: boolean
  ccSwitchOpen: boolean
}

/** Reads the {@link TourPage} facts from the current document. */
export function readTourPage(pathname: string): TourPage {
  const list = document.querySelector<HTMLElement>('[data-tour="key-list"]')
  const count = list?.dataset.keyCount
  const nameInput = document.querySelector<HTMLInputElement>(KEY_NAME_INPUT)
  return {
    onKeysPage: pathname === KEYS_PATH,
    keyCount: count === undefined ? null : Number(count),
    keyFormOpen: document.querySelector(SAVE_KEY_TARGET) !== null,
    keyNamed:
      nameInput !== null &&
      nameInput.value.trim() !== '' &&
      document.activeElement !== nameInput,
    keyGroupPicked:
      document.querySelector(
        `${KEY_GROUP_TARGET}[data-group-picked="true"]`
      ) !== null,
    groupListOpen:
      document
        .querySelector(KEY_GROUP_TRIGGER)
        ?.getAttribute('aria-expanded') === 'true',
    ccSwitchOpen: document.querySelector(CC_SWITCH_OPEN_TARGET) !== null,
  }
}

/**
 * The step to show, worked out from what the user already did and what is
 * on the page rather than from a step counter. A user who closes the
 * drawer or the dialog, or opens a page by other means, is shown the step
 * that fits. Returns null while there is nothing to point at: the key list
 * is still loading, or the group list is open.
 */
export function currentTourStep(
  run: Pick<TourRun, 'welcomed' | 'installed' | 'pickedApp' | 'imported'>,
  page: TourPage
): TourStepId | null {
  if (!run.welcomed) return 'welcome'
  if (!run.installed) return 'install'
  if (run.imported) return 'done'
  if (page.ccSwitchOpen) return run.pickedApp ? 'import' : 'pick-app'
  if (page.keyFormOpen) {
    if (page.groupListOpen) return null
    if (!page.keyNamed) return 'name-key'
    // A key outside every group reaches no model, so it must be picked.
    if (!page.keyGroupPicked) return 'pick-group'
    return 'save-key'
  }
  if (!page.onKeysPage) return 'open-keys'
  if (page.keyCount === null) return null
  return page.keyCount > 0 ? 'open-cc-switch' : 'create-key'
}
