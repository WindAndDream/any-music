/** Human-readable projection of bounded native JSON. Unknown fields remain inspectable
 * under an explicit details disclosure; they never become HTML, URLs or host actions. */
export function presentNativePluginResult(value: unknown) {
  const object = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const items = Array.isArray(object.items)
    ? object.items
        .slice(0, 100)
        .flatMap((item) =>
          item && typeof item === 'object' && typeof item.title === 'string' ? [item.title] : [],
        )
    : []
  const suggestions = Array.isArray(object.suggestions)
    ? object.suggestions.slice(0, 20).flatMap((item) =>
        item && typeof item === 'object' && typeof item.id === 'string' && Array.isArray(item.tags)
          ? [
              {
                id: item.id,
                tags: item.tags
                  .filter((tag: unknown) => typeof tag === 'string')
                  .slice(0, 32) as string[],
              },
            ]
          : [],
      )
    : []
  return {
    text: typeof object.text === 'string' ? object.text : undefined,
    items,
    suggestions,
    saved: object.saved === true,
    unavailable: object.status === 'denied' || object.status === 'unavailable',
  }
}
