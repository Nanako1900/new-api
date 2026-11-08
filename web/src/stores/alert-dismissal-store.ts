import * as z from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const ALERT_DISMISSALS_STORAGE_KEY = 'console-alert-dismissals'

const persistedDismissalsSchema = z.object({
  dismissedKeys: z.array(z.string()),
})

type AlertDismissalState = {
  /** Keys from getAlertDismissKey: one per dismissed alert version. */
  dismissedKeys: string[]
  dismiss: (key: string) => void
  /** Keep only the keys of alert versions the server still returns as live. */
  prune: (liveKeys: string[]) => void
}

/**
 * Console alerts the user closed in this browser. Persisted to localStorage;
 * nothing is stored on the server. The banner reloads it when another tab
 * writes, so tabs share one list.
 */
export const useAlertDismissalStore = create<AlertDismissalState>()(
  persist(
    (set, get) => ({
      dismissedKeys: [],
      dismiss: (key) => {
        const keys = get().dismissedKeys
        if (keys.includes(key)) return
        set({ dismissedKeys: [...keys, key] })
      },
      prune: (liveKeys) => {
        const keys = get().dismissedKeys
        const kept = keys.filter((key) => liveKeys.includes(key))
        // persist writes on every set(); skipping no-op writes keeps a tab
        // with a stale list from erasing another tab's dismissals.
        if (kept.length !== keys.length) set({ dismissedKeys: kept })
      },
    }),
    {
      name: ALERT_DISMISSALS_STORAGE_KEY,
      partialize: (state) => ({ dismissedKeys: state.dismissedKeys }),
      // localStorage is user-editable: fall back to an empty list.
      merge: (persisted, current) => {
        const parsed = persistedDismissalsSchema.safeParse(persisted)
        return {
          ...current,
          dismissedKeys: parsed.success ? parsed.data.dismissedKeys : [],
        }
      },
    }
  )
)
