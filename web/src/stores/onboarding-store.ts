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
import * as z from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const ONBOARDING_STORAGE_KEY = 'meow-onboarding'

const progressSchema = z.object({
  /** The tour has been shown once, so it no longer opens by itself. */
  seen: z.boolean().catch(false),
  /** The user said CC Switch is installed (or went to download it). */
  installed: z.boolean().catch(false),
  /** The user sent a key to CC Switch at least once. */
  imported: z.boolean().catch(false),
})

export type OnboardingProgress = z.infer<typeof progressSchema>

const runSchema = z.object({
  userId: z.number(),
  welcomed: z.boolean(),
  installed: z.boolean(),
  pickedApp: z.boolean(),
  imported: z.boolean(),
})

/** A tour in progress: which of its click-through steps were passed. */
export type TourRun = z.infer<typeof runSchema>

const persistedSchema = z.object({
  progress: z.record(z.string(), progressSchema).catch({}),
  run: runSchema.nullable().catch(null),
})

/** Where a tour starts; a later start counts the cards before it as passed. */
export type TourStart = 'welcome' | 'install' | 'keys'

export const EMPTY_ONBOARDING_PROGRESS: OnboardingProgress = {
  seen: false,
  installed: false,
  imported: false,
}

type OnboardingState = {
  /** Progress per user id, so accounts sharing a browser keep their own. */
  progress: Record<string, OnboardingProgress>
  run: TourRun | null
  startTour: (userId: number, from?: TourStart) => void
  updateRun: (patch: Partial<Omit<TourRun, 'userId'>>) => void
  endTour: () => void
  markProgress: (userId: number, patch: Partial<OnboardingProgress>) => void
  /** The user sent a key to CC Switch, inside the tour or not. */
  recordImport: (userId: number) => void
}

/**
 * The console onboarding tour and the getting-started checklist. Persisted
 * to localStorage, including a tour in progress so a reload resumes it;
 * nothing is stored on the server.
 */
export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      progress: {},
      run: null,
      startTour: (userId, from = 'welcome') => {
        get().markProgress(userId, { seen: true })
        set({
          run: {
            userId,
            welcomed: from !== 'welcome',
            installed: from === 'keys',
            pickedApp: false,
            imported: false,
          },
        })
      },
      updateRun: (patch) => {
        const run = get().run
        if (run) set({ run: { ...run, ...patch } })
      },
      endTour: () => set({ run: null }),
      markProgress: (userId, patch) => {
        const key = String(userId)
        const current = get().progress[key] ?? EMPTY_ONBOARDING_PROGRESS
        set({
          progress: { ...get().progress, [key]: { ...current, ...patch } },
        })
      },
      recordImport: (userId) => {
        get().markProgress(userId, { imported: true })
        if (get().run?.userId === userId) get().updateRun({ imported: true })
      },
    }),
    {
      name: ONBOARDING_STORAGE_KEY,
      partialize: (state) => ({ progress: state.progress, run: state.run }),
      // localStorage is user-editable: drop anything that does not parse.
      merge: (persisted, current) => {
        const parsed = persistedSchema.safeParse(persisted)
        if (!parsed.success) return current
        return { ...current, ...parsed.data }
      },
    }
  )
)

/** One user's onboarding progress, or the empty progress if none is stored. */
export function selectOnboardingProgress(userId: number | undefined) {
  return (state: OnboardingState) =>
    (userId !== undefined && state.progress[String(userId)]) ||
    EMPTY_ONBOARDING_PROGRESS
}
