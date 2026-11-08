import { defaultRangeExtractor } from '@tanstack/vue-virtual'

/** Keep natural overscan plus explicit interaction occurrences, without filling intervening gaps. */
export function createVirtualRetainedRange(indexes: readonly number[], count: number, columns = 1) {
  const valid = [
    ...new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < count)),
  ]
  if (valid.length > 32) throw new RangeError('Virtual retained range exceeds 32 occurrences')
  const retained = valid.map((index) => Math.floor(index / columns))
  return (range: Parameters<typeof defaultRangeExtractor>[0]) =>
    [...new Set([...defaultRangeExtractor(range), ...retained])].toSorted(
      (left, right) => left - right,
    )
}
