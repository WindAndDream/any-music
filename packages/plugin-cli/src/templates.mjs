import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { refuse } from './diagnostic.mjs'
import { TOOL_VERSION } from './project.mjs'

export const TEMPLATES = [
  'source-declarative',
  'source-code',
  'source-gateway',
  'tag-suggestion',
  'export',
]

/** Versioned, bundled templates only. Creation never installs or executes anything. */
export async function createProject(destination, template) {
  if (!TEMPLATES.includes(template))
    refuse(
      'TEMPLATE',
      'template',
      'Unknown bundled template.',
      'Choose a supported versioned template.',
      2,
    )
  const name = destination.split(/[\\/]/).at(-1)
  if (!/^[a-z][a-z0-9-]{0,48}$/.test(name))
    refuse('PROJECT_NAME', 'destination', 'Use a lowercase project name.', undefined, 2)
  const root = resolve(destination)
  try {
    await mkdir(root)
  } catch {
    refuse(
      'DESTINATION',
      'destination',
      'Destination exists or cannot be created.',
      'Choose a new project directory.',
      2,
    )
  }
  const code = !['source-declarative', 'source-gateway'].includes(template)
  const title = {
    'source-code': 'Public source',
    'source-declarative': 'Static source',
    'source-gateway': 'Authenticated API source',
    'tag-suggestion': 'Title tag suggestions',
    export: 'Selected title export',
  }[template]
  const manifest = {
    $schema: './plugin-manifest.schema.json',
    manifestVersion: 1,
    packageFormatVersion: 1,
    id: 'org.example.' + name,
    version: '0.1.0',
    name: { en: title, 'zh-CN': title },
    description: { en: title, 'zh-CN': title },
    sdk: { minimum: TOOL_VERSION, maximumExclusive: '1.0.0' },
    wireVersions: [1],
    runtimeProfileVersion: 1,
    contributionVersion: 1,
    dataSchemaVersion: 1,
    execution: code ? 'sandbox-code' : 'declarative',
    ...(code ? { entry: 'dist/main.js' } : {}),
    integrity: 'integrity.json',
    forms: ['desktop', 'mobile'],
    capabilities: (template === 'tag-suggestion'
      ? ['state.read', 'state.write']
      : template === 'source-gateway'
        ? ['source.authentication', 'network.publicHttps']
        : template === 'source-code'
          ? ['crypto.sha256']
          : []
    )
      .map((id) => ({ id, version: 1, required: true, reason: { en: title, 'zh-CN': title } }))
      .concat(
        template === 'source-code'
          ? [
              {
                id: 'network.publicHttps',
                version: 1,
                required: false,
                reason: {
                  en: 'Read a user-selected public JSON catalog anonymously',
                  'zh-CN': '匿名读取用户选择的公共 JSON 目录',
                },
              },
            ]
          : [],
      ),
    commands: [
      {
        id: template.startsWith('source-') ? 'search' : 'run',
        title: { en: title, 'zh-CN': title },
      },
    ],
    contributions: template.startsWith('source-')
      ? [
          {
            contributionId: 'catalog',
            pointId: 'music.sources',
            contractVersion: 1,
            required: true,
            title: { en: title, 'zh-CN': title },
            scope: { sections: ['catalog'], forms: ['desktop'] },
            providerId: 'org.example.' + name,
            inputSchemaId: 'urn:any-music:plugin:command-context:1',
            eventSchemaId: 'urn:any-music:plugin:ui-event:1',
            cardinality: 'many',
            fallback: 'hidden',
            budgetProfileVersion: 1,
          },
        ]
      : [],
    activationEvents: [],
    memoryClass: 'minimum',
  }
  if (template === 'source-gateway')
    manifest.sourceAuthentication = {
      protocolVersion: 1,
      apiBaseUrl: 'https://api.example.com/music/',
      allowUnauthenticated: false,
      methods: ['credentials'],
      credentialFields: [
        { id: 'token', label: { en: 'API token', 'zh-CN': 'API Token' }, secret: true },
      ],
    }
  const catalog = [
    {
      id: 'sample-live',
      title: 'Live concert',
      artists: [{ name: 'Example artist' }],
      source: { pluginId: manifest.id, mediaKind: 'audio', resourceId: 'sample-live' },
    },
    {
      id: 'sample-studio',
      title: 'Studio recording',
      artists: [{ name: 'Example artist' }],
      source: { pluginId: manifest.id, mediaKind: 'audio', resourceId: 'sample-studio' },
    },
  ]
  const algorithm =
    template === 'source-code'
      ? `const remote = (input.query || '').startsWith('https://')
  if(remote) {
    const saved = JSON.parse(inv.checkpointJson || '{}')
    if(inv.sequence===0)return requestHost(inv,'network.request',{url:input.query!,method:'GET'},{text:'',offset:0})
    if(!inv.response?.ok)return complete({status:'unavailable',message:'Anonymous public catalog capability unavailable'})
    if(inv.response.operation==='network.releaseResponse')return complete(saved.page)
    if(inv.response.operation==='network.request') {
      if(inv.response.result.status!==200 || inv.response.result.sizeBytes>65536)return complete({status:'unavailable',message:'Public catalog exceeds its budget'})
      return requestHost(inv,'network.readResponse',{responseRef:inv.response.result.responseRef,offset:0,length:16384},{text:'',offset:0,ref:inv.response.result.responseRef})
    }
    if(inv.response.operation==='network.readResponse') {
      const text=saved.text+inv.response.result.text
      if(text.length>65536)return complete({status:'unavailable'})
      if(!inv.response.result.done)return requestHost(inv,'network.readResponse',{responseRef:saved.ref,offset:inv.response.result.nextOffset,length:16384},{text,offset:inv.response.result.nextOffset,ref:saved.ref})
      const all=JSON.parse(text).items.map((item:any)=>({...item,source:{...item.source,pluginId:${JSON.stringify(manifest.id)}}}))
      const number=input.pageNumber || 1, start=(number-1)*20
      return requestHost(inv,'network.releaseResponse',{responseRef:saved.ref},{page:{items:all.slice(start,start+20),pageNumber:number,pageSize:20,total:all.length,hasMore:start+20<all.length}})
    }
    return complete({status:'unavailable'})
  }
  if (inv.sequence === 0) return requestHost(inv, 'crypto.sha256', {text: input.query || 'catalog'})
  if (!inv.response?.ok) return complete({status:'unavailable', message:'Host SHA-256 capability unavailable'})
  const items = ${JSON.stringify(catalog)}.filter(item => item.title.toLowerCase().includes((input.query || '').toLowerCase()))
  const number=input.pageNumber || 1, start=(number-1)*20
  return complete({items: items.slice(start,start+20), pageNumber:number, pageSize:20, total:items.length, hasMore:start+20<items.length})`
      : template === 'tag-suggestion'
        ? `const suggestions = (input.items || []).slice(0,20).map(item => ({id:item.id, tags:item.title.toLowerCase().includes('live') ? ['live'] : []}))
  if (inv.sequence === 0) return requestHost(inv,'state.get',{key:'suggestions'})
  if (!inv.response?.ok) return complete({status:'denied', suggestions})
  if (inv.sequence === 1 && inv.response.operation === 'state.get') return requestHost(inv,'state.set',{key:'suggestions',schemaVersion:1,value:JSON.stringify(suggestions),expectedVersion:inv.response.result.version,operationId:inv.contextRef + ':tags'}, suggestions)
  return complete({suggestions, saved:true})`
        : `return complete({suggestedName:'titles.txt', text:(input.items || []).slice(0,20).map(item=>item.title).join('\\n')})`
  const source = `import {complete, requestHost} from '@any-music/plugin-sdk/guest'
import type {GuestInvocation, GuestStep} from '@any-music/plugin-sdk/guest'
export default function run(inv: GuestInvocation): GuestStep {
  if (!inv || typeof inv.inputJson !== 'string') return complete({ready:true})
  const input = JSON.parse(inv.inputJson) as {query?:string; pageNumber?:number; pageSize?:number; items?:{id:string;title:string}[]}
  ${algorithm}
}
`
  const test = `import run from '../src/main'
import type {GuestInvocation} from '@any-music/plugin-sdk/guest'
export default function test() {
  let invocation: GuestInvocation = {operation:'command.run',inputJson:JSON.stringify({query:'live',items:[{id:'one',title:'Live concert'}]}),contextRef:'test-context',sequence:0,deadlineMs:30000}
  let result = run(invocation)
  for (let step=0; result.kind === 'host' && step<4; step++) {
    const req = result.request
    const response = req.operation === 'state.get' ? {value:null,version:0} : req.operation === 'crypto.sha256' ? {hex:'0'.repeat(64)} : {value:'[]',version:1}
    if (step===0) {
      const denied = run({...invocation,sequence:1,response:{wireVersion:1,requestId:req.requestId,operation:req.operation,ok:false,error:{code:'access-denied',message:'Denied',isRetryable:false}}})
      if (denied.kind !== 'complete') throw new Error('Denied capability must degrade')
    }
    invocation = {...invocation,sequence:invocation.sequence+1,checkpointJson:result.checkpointJson,response:{wireVersion:1,requestId:req.requestId,operation:req.operation,ok:true,result:response} as any}
    result = run(invocation)
  }
  if (result.kind !== 'complete') throw new Error('Step budget')
  const output = JSON.parse(result.outputJson)
  if (!(output.items?.[0]?.title === 'Live concert' || output.suggestions?.[0]?.tags?.[0] === 'live' || output.text === 'Live concert')) throw new Error('Visible result')
  return {passed:true,cases:['selected-data','named-request','denied-capability','retry-in-fresh-context','visible-output']}
}
`
  const files = {
    'plugin.json': JSON.stringify(manifest, null, 2),
    'plugin.config.json': JSON.stringify(
      {
        version: 1,
        entry: 'src/main.ts',
        test: 'test/main.test.ts',
        assets: ['assets/source.json'],
      },
      null,
      2,
    ),
    'assets/source.json': JSON.stringify({ schemaVersion: 1, items: catalog }),
    'src/main.ts': source,
    'test/main.test.ts': test,
    'test/fixtures/migration.json': JSON.stringify({ schemaVersion: 1, values: {} }),
    'locales/en.json': JSON.stringify({ title }),
    'locales/zh-CN.json': JSON.stringify({ title }),
    'plugin-manifest.schema.json': JSON.stringify({
      $ref: './node_modules/@any-music/plugin-sdk/schema/v1/protocol.schema.json#/$defs/PluginManifest',
    }),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2023'],
          types: [],
          strict: true,
          noEmit: true,
        },
        include: ['src', 'test'],
      },
      null,
      2,
    ),
    'package.json': JSON.stringify(
      {
        name,
        version: '0.1.0',
        private: true,
        type: 'module',
        packageManager: 'pnpm@10.23.0',
        dependencies: { '@any-music/plugin-sdk': TOOL_VERSION },
        devDependencies: {
          '@any-music/plugin-cli': TOOL_VERSION,
          '@any-music/plugin-testkit': TOOL_VERSION,
        },
        scripts: {
          check: 'am-plugin check',
          test: 'am-plugin test',
          pack: 'am-plugin pack --reproducible',
        },
      },
      null,
      2,
    ),
    // Lock records are materialized by the author's explicit pnpm install. Doctor reports this
    // bootstrap state; no remote resolution or install script is triggered by create.
    'pnpm-lock.yaml':
      "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
    LICENSE:
      'Copyright (c) plugin author\n\n' +
      (await readFile(new URL('../LICENSE', import.meta.url), 'utf8')),
    'README.md': `# ${title}\n\nTemplate ${template} v${TOOL_VERSION}.\n\nRun pnpm install --ignore-scripts explicitly to resolve the exact tool versions and update the bootstrap lockfile. Commit that lockfile; CI uses pnpm install --frozen-lockfile --ignore-scripts. Then am-plugin check, am-plugin test, am-plugin pack --reproducible and am-plugin verify <package>.\n\nDesktop: install the exact package preview and explicitly select capabilities. Run commands in the plugin center using selected library titles. Tag suggestions persist in the plugin namespace; exports require a native save dialog. Source samples register metadata catalogs in the workbench picker. The code template can optionally read a public HTTPS JSON catalog (64 KiB) with native approval; pages are consumed on demand. The current host catalog adapter does not provide audio resolution. No host globals or direct network are available. Each named request is native-authorized before a fresh VM resumes. Every DEV reload requires host approval and is isolated from product data and Cookies. Mobile remains unavailable until S16 device admission.\n`,
  }
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(root, path)
    // oxlint-disable-next-line no-await-in-loop
    await mkdir(resolve(target, '..'), { recursive: true })
    // oxlint-disable-next-line no-await-in-loop
    await writeFile(target, content, { flag: 'wx' })
  }
  return {
    template,
    version: TOOL_VERSION,
    project: name,
    dependencyInstallation: 'explicit',
    next: [
      'pnpm install --ignore-scripts',
      'am-plugin check',
      'am-plugin test',
      'am-plugin pack --reproducible',
    ],
  }
}
