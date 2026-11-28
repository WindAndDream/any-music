import type { InjectionKey } from 'vue'

export interface FilterDialogRequest {
  title: string
  description?: string
  returnFocusSelector: string
  platformHistory?: { labels: readonly string[]; restore: () => void }
}

export const filterDialogKey: InjectionKey<(request: FilterDialogRequest) => void> =
  Symbol('filter-dialog')
