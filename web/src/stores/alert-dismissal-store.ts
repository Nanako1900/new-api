import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type AlertDismissalState = {
  /** Keys from getAlertDismissKey, formatted `${id}:${hash}`. */
  dismissedKeys: string[]
  dismiss: (key: string) => void
  /** Drop keys of alerts the server no longer returns as live. */
  prune: (liveIds: number[]) => void
}

/**
 * Console alerts the user closed in this browser. Persisted to localStorage;
 * nothing is stored on the server.
 */
export const useAlertDismissalStore = create<AlertDismissalState>()(
  persist(
    (set) => ({
      dismissedKeys: [],
      dismiss: (key) =>
        set((state) =>
          state.dismissedKeys.includes(key)
            ? state
            : { dismissedKeys: [...state.dismissedKeys, key] }
        ),
      prune: (liveIds) =>
        set((state) => {
          const kept = state.dismissedKeys.filter((key) =>
            liveIds.includes(Number(key.slice(0, key.indexOf(':'))))
          )
          return kept.length === state.dismissedKeys.length
            ? state
            : { dismissedKeys: kept }
        }),
    }),
    {
      name: 'console-alert-dismissals',
      partialize: (state) => ({ dismissedKeys: state.dismissedKeys }),
    }
  )
)
