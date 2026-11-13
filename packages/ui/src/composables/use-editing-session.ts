import { getCurrentInstance, inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

/** Typed, in-memory editing cells only. Never store services, media or persistence ports here. */
export interface EditingStateKey<State> {
  readonly token: symbol
  readonly stateType?: (value: State) => State
}

export interface EditingSession {
  readonly active: boolean
  state<State>(key: EditingStateKey<State>, create: () => State): State
  scope(id: string): EditingSession
  clearScope(id: string): void
  reset(): void
  dispose(): void
}

const EDITING_SESSION: InjectionKey<EditingSession> = Symbol('product-editing-session')

export function editingStateKey<State>(name: string): EditingStateKey<State> {
  return { token: Symbol(name) }
}

/** The owner disposes this session; unmounting a consumer never clears its drafts. */
export function createEditingSession(): EditingSession {
  const cells = new Map<symbol, unknown>()
  const scopes = new Map<string, EditingSession>()
  let disposed = false
  function assertActive(): void {
    if (disposed) throw new Error('Editing session has been disposed.')
  }
  return {
    get active() {
      return !disposed
    },
    state<State>(key: EditingStateKey<State>, create: () => State): State {
      assertActive()
      if (!cells.has(key.token)) cells.set(key.token, create())
      return cells.get(key.token) as State
    },
    scope(id) {
      assertActive()
      if (!scopes.has(id)) scopes.set(id, createEditingSession())
      return scopes.get(id)!
    },
    clearScope(id) {
      assertActive()
      scopes.get(id)?.dispose()
      scopes.delete(id)
    },
    reset() {
      assertActive()
      for (const scope of scopes.values()) scope.dispose()
      scopes.clear()
      cells.clear()
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const scope of scopes.values()) scope.dispose()
      scopes.clear()
      cells.clear()
    },
  }
}

export function provideEditingSession(session: EditingSession): void {
  provide(EDITING_SESSION, session)
}

/** Standalone controlled views get a local session; production supplies a stable owner. */
export function useEditingSession(id?: string): EditingSession {
  const owner =
    (getCurrentInstance() ? inject(EDITING_SESSION, undefined) : undefined) ??
    createEditingSession()
  return id === undefined ? owner : owner.scope(id)
}
