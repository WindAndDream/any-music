import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const schema = JSON.parse(
  readFileSync(
    new URL('../packages/plugin-sdk/schema/v1/protocol.schema.json', import.meta.url),
    'utf8',
  ),
)
const registry = JSON.parse(
  readFileSync(new URL('../packages/plugin-sdk/schema/registry.json', import.meta.url), 'utf8'),
)
const definitions = schema.$defs
if (schema.$id !== registry.schemaId) throw new Error('Rust schema registry drift')
const output = []
const unionChecks = []
let unionIndex = 0
const checkNames = new Map()
const quote = JSON.stringify
const pascal = (value) =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')
const snake = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
const fieldName = (key) =>
  ['type', 'ref', 'self', 'mod'].includes(snake(key)) ? `r#${snake(key)}` : snake(key)

function type(node, name) {
  if (node.$ref) return node.$ref.slice(8)
  if (node.oneOf) {
    const variants = node.oneOf.map(
      (child, index) => `V${index}(Box<${type(child, `${name}V${index}`)}>)`,
    )
    output.push(
      `#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]\n#[serde(untagged)]\npub enum ${name} { ${variants.join(',')} }`,
    )
    return name
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== false) throw new Error(`Open Rust DTO: ${name}`)
    const fields = Object.entries(node.properties ?? {}).map(([key, child]) => {
      const required = node.required?.includes(key)
      const kind = type(child, name + pascal(key))
      // Missing and explicit null are distinct in the Schema. Validation precedes serde.
      return `#[serde(rename = ${quote(key)}${required ? '' : ', default, skip_serializing_if = "Option::is_none"'})]\npub ${fieldName(key)}: ${required ? kind : `Option<${kind}>`}`
    })
    output.push(
      `#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]\n#[serde(deny_unknown_fields)]\npub struct ${name} { ${fields.join(',\n')} }`,
    )
    return name
  }
  if (node.type === 'array') return `Vec<${type(node.items, `${name}Item`)}>`
  if (node.enum || typeof node.const === 'string') {
    const values = node.enum ?? [node.const]
    output.push(
      `#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]\npub enum ${name} { ${values.map((value) => `#[serde(rename = ${quote(value)})] ${pascal(value)}`).join(',')} }`,
    )
    output.push(
      `impl ${name} { pub fn as_str(&self) -> &'static str { match self { ${values.map((value) => `Self::${pascal(value)} => ${quote(value)},`).join('')} } } }`,
    )
    return name
  }
  if (Array.isArray(node.type)) {
    if (node.type.join(',') !== 'string,null') throw new Error('Unsupported nullable type')
    return 'Option<String>'
  }
  if (node.type === 'string') return 'String'
  if (node.type === 'integer' || node.type === 'number') return 'i64'
  if (node.type === 'boolean') return 'bool'
  if (node.type === 'null') return '()'
  throw new Error(`Unsupported DTO: ${name}`)
}

/** Compile only the registered closed subset into Rust field checks; no runtime Schema engine. */
function check(node, value) {
  const key = JSON.stringify(node)
  if (!checkNames.has(key)) {
    const name = `is_schema_node_${unionIndex++}`
    checkNames.set(key, name)
    const expression = checkExpression(node, 'v')
    unionChecks.push(`fn ${name}(v: &serde_json::Value) -> bool { ${expression} }`)
  }
  return `${checkNames.get(key)}(${value})`
}

function checkExpression(node, value) {
  const known = new Set([
    '$ref',
    'oneOf',
    'type',
    'properties',
    'required',
    'additionalProperties',
    'title',
    'items',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'const',
    'enum',
  ])
  for (const key of Object.keys(node))
    if (!known.has(key)) throw new Error(`Unsupported Rust schema keyword: ${key}`)
  if (node.$ref) {
    const name = node.$ref.slice(8)
    if (node.$ref !== `#/$defs/${name}` || !definitions[name])
      throw new Error('Unregistered Rust reference')
    return `is_${snake(name)}(${value})`
  }
  if (node.oneOf) {
    const branches = node.oneOf.map((child) => check(child, value))
    return `[${branches.join(',')}].into_iter().filter(|accepted| *accepted).count() == 1`
  }
  let expression
  if (node.type === 'object') {
    if (node.additionalProperties !== false) throw new Error('Open object')
    const fields = Object.entries(node.properties ?? {})
    expression = `${value}.as_object().is_some_and(|o| o.keys().all(|k| [${fields.map(([key]) => quote(key)).join(',')}].contains(&k.as_str()))${fields.map(([key, child]) => ` && o.get(${quote(key)}).${node.required?.includes(key) ? 'is_some_and' : 'is_none_or'}(|v| ${check(child, 'v')})`).join('')})`
    if (!fields.length) expression = `${value}.as_object().is_some_and(|o| o.is_empty())`
  } else if (node.type === 'array') {
    expression = `${value}.as_array().is_some_and(|a| a.len() >= ${node.minItems ?? 0} && a.len() <= ${node.maxItems} && a.iter().all(|v| ${check(node.items, 'v')}))`
    if ((node.minItems ?? 0) === 0) expression = expression.replace('a.len() >= 0 && ', '')
    if (node.minItems === 1)
      expression = expression.replace('a.len() >= 1 && ', '!a.is_empty() && ')
  } else if (node.type === 'string') {
    const bounds = [
      !node.minLength ? null : `s.chars().count() >= ${node.minLength}`,
      node.maxLength === undefined ? null : `s.chars().count() <= ${node.maxLength}`,
    ].filter(Boolean)
    expression = bounds.length
      ? `${value}.as_str().is_some_and(|s| ${bounds.join(' && ')})`
      : `${value}.is_string()`
  } else if (node.type === 'integer' || node.type === 'number') {
    expression = `${value}.as_i64().is_some_and(|n| (${node.minimum ?? -9007199254740991}..=${node.maximum ?? 9007199254740991}).contains(&n))`
  } else if (node.type === 'boolean') expression = `${value}.is_boolean()`
  else if (node.type === 'null') expression = `${value}.is_null()`
  else if (Array.isArray(node.type) && node.type.join(',') === 'string,null')
    expression = `(${value}.is_null() || ${check({ ...node, type: 'string' }, value)})`
  else throw new Error(`Unsupported Rust check: ${JSON.stringify(node)}`)
  if ('const' in node)
    expression = `${expression} && ${value} == &serde_json::json!(${quote(node.const)})`
  if (node.enum)
    expression = `${expression} && [${node.enum.map(quote).join(',')}].contains(&${value}.as_str().unwrap_or_default())`
  return expression
}

for (const [name, node] of Object.entries(definitions)) {
  const kind = type(node, name)
  if (kind !== name) throw new Error(`Top-level alias unsupported: ${name}`)
  output.push(
    `impl crate::ProtocolDto for ${name} { const SCHEMA: &'static str = ${quote(name)}; }`,
  )
  output.push(`fn is_${snake(name)}(v: &serde_json::Value) -> bool { ${check(node, 'v')} }`)
}
output.push(
  `pub(crate) fn validate(name: &str, v: &serde_json::Value) -> bool { match name { ${Object.keys(
    definitions,
  )
    .map((name) => `${quote(name)} => is_${snake(name)}(v),`)
    .join('\n')} _ => false } }`,
)
const constants = Object.entries(registry).filter(
  ([key, value]) =>
    key !== 'limits' &&
    (typeof value === 'number' || typeof value === 'string' || Array.isArray(value)),
)
for (const [key, value] of constants) {
  const kind = typeof value === 'number' ? 'i64' : typeof value === 'string' ? '&str' : '&[&str]'
  output.push(
    `pub const ${snake(key).toUpperCase()}: ${kind} = ${Array.isArray(value) ? '&' : ''}${quote(value)};`,
  )
}
for (const [key, value] of Object.entries(registry.limits))
  output.push(`pub const LIMIT_${snake(key).toUpperCase()}: usize = ${value};`)
const source =
  `// Generated from plugin-sdk/schema. Do not edit; run pnpm generate:protocol.\n${output.join('\n\n')}\n${unionChecks.join('\n\n')}\n`.replaceAll(
    /\|v\| (is_[a-z0-9_]+)\(v\)/g,
    '$1',
  )
const formatted = execFileSync('rustfmt', ['--edition', '2024', '--emit', 'stdout'], {
  cwd: root,
  input: source,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
const path = new URL('../crates/am-plugin-protocol/src/generated.rs', import.meta.url)
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== formatted.replaceAll('\r\n', '\n'))
    throw new Error('Rust protocol generated artifact drift')
} else writeFileSync(path, formatted)
console.log(
  `Rust serde DTOs/field checks ${process.argv.includes('--check') ? 'match' : 'generated'} (${Object.keys(definitions).length} definitions).`,
)
