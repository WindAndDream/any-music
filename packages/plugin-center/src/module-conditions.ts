import type { ContributionScope, ModuleContext, WhenExpression } from './module-contracts'
import { ModuleFrameworkError } from './module-contracts'

const CONTEXT_FIELDS = new Set([
  'runtime',
  'form',
  'area',
  'listType',
  'selectionCount',
  'hasTrack',
])

/** Bounded host-interpreted AST. Unknown fields/operators fail closed, including under negation. */
export function validateModuleWhen(
  expression: WhenExpression,
  depth = 0,
  budget = { count: 0 },
): void {
  if (++budget.count > 64 || depth > 8 || !expression || typeof expression !== 'object')
    throw new ModuleFrameworkError('invalid-condition', [])
  const keys = Object.keys(expression)
  if ('field' in expression) {
    if (
      keys.length !== 2 ||
      !CONTEXT_FIELDS.has(expression.field) ||
      !('equals' in expression) ||
      !['string', 'number', 'boolean'].includes(typeof expression.equals)
    )
      throw new ModuleFrameworkError('invalid-condition', [])
    return
  }
  if (keys.length !== 1) throw new ModuleFrameworkError('invalid-condition', [])
  if ('not' in expression) return validateModuleWhen(expression.not, depth + 1, budget)
  const children =
    'all' in expression ? expression.all : 'any' in expression ? expression.any : undefined
  if (!Array.isArray(children) || children.length === 0)
    throw new ModuleFrameworkError('invalid-condition', [])
  for (const child of children) validateModuleWhen(child, depth + 1, budget)
}

export function matchesModuleWhen(
  expression: WhenExpression | undefined,
  context: ModuleContext,
): boolean {
  if (!expression) return true
  try {
    validateModuleWhen(expression)
  } catch {
    return false
  }
  function evaluate(node: WhenExpression): boolean {
    if ('field' in node) return context[node.field] === node.equals
    if ('all' in node) return node.all.every(evaluate)
    if ('any' in node) return node.any.some(evaluate)
    return !evaluate(node.not)
  }
  return evaluate(expression)
}

export function matchesModuleScope(
  scope: ContributionScope | undefined,
  context: ModuleContext,
): boolean {
  return (
    (!scope?.runtimes || scope.runtimes.includes(context.runtime)) &&
    (!scope?.forms || scope.forms.includes(context.form)) &&
    (!scope?.areas || scope.areas.includes(context.area)) &&
    (!scope?.listTypes ||
      (context.listType !== undefined && scope.listTypes.includes(context.listType)))
  )
}
