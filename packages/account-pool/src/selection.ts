import { operationKey } from './catalog'
import type { AccountProfile, AccountOperationPolicy } from './catalog'

interface ShuffleState {
  fingerprint: string
  remaining: string[]
}

/** Bounded per-operation shuffle bags; random source is injectable for deterministic tests. */
export class AccountSelector {
  private readonly bags = new Map<string, ShuffleState>()
  private readonly random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  order(
    platformId: string,
    operation: string,
    candidates: readonly Readonly<AccountProfile>[],
    mode: AccountOperationPolicy['selection'],
  ): readonly Readonly<AccountProfile>[] {
    if (!candidates.length) return []
    const key = operationKey(platformId, operation)
    const byId = new Map(candidates.map((account) => [account.id, account]))
    if (byId.size !== candidates.length) throw new TypeError('Duplicate selection candidate.')
    const ids = [...byId.keys()]
    const fingerprint = JSON.stringify(ids)
    let primary: string
    if (mode === 'random') {
      this.bags.delete(key)
      primary = ids[this.index(ids.length)]!
    } else {
      let state = this.bags.get(key)
      if (!state || state.fingerprint !== fingerprint || !state.remaining.length) {
        state = { fingerprint, remaining: this.shuffle(ids) }
      }
      // Reserve the primary synchronously, so concurrent operations cannot reuse it within a cycle.
      primary = state.remaining.pop()!
      this.bags.delete(key)
      this.bags.set(key, state)
      if (this.bags.size > 512) this.bags.delete(this.bags.keys().next().value!)
    }
    // Fallback never repeats an account within the operation, regardless of selection mode.
    return [
      byId.get(primary)!,
      ...this.shuffle(ids.filter((id) => id !== primary)).map((id) => byId.get(id)!),
    ]
  }

  clear(platformId: string, operation: string): void {
    this.bags.delete(operationKey(platformId, operation))
  }

  private shuffle(ids: readonly string[]): string[] {
    const result = [...ids]
    for (let index = result.length - 1; index > 0; index--) {
      const target = this.index(index + 1)
      ;[result[index], result[target]] = [result[target]!, result[index]!]
    }
    return result
  }

  private index(length: number): number {
    if (length === 1) return 0
    const value = this.random()
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new RangeError('Random source must return [0, 1).')
    return Math.floor(value * length)
  }
}
