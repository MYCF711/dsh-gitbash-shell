// Targeted DSH 0.2.2-rc.1 compatibility probe for the installed 0.47.2 baseline.
// Run only with the rc1 Electron binary in ELECTRON_RUN_AS_NODE=1 mode.
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const asar = process.env.DSH_RC1_ASAR ?? 'D:/DeepSeek Harness/Desktop-0.2.2-rc.1/resources/app.asar'
const worktree = dirname(dirname(fileURLToPath(import.meta.url)))
const resultPath = process.env.DSH_RC1_RESULT
const hostRoot = join(asar, 'dsh/node_modules')
const hostAnchor = join(asar, 'dsh/package.json')
const require = createRequire(hostAnchor)
const result = { kind: 'dsh-gitbash-shell-rc1-compat', ok: false, host: {}, checks: {}, observations: {} }
const check = (name, value, detail) => {
  result.checks[name] = value === true
  console.log(`${value === true ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
  assert.equal(value, true, name)
}
const save = () => {
  if (resultPath) writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

function hostFile(specifier) {
  const parts = specifier.split('/')
  const packageName = parts.slice(0, 2).join('/')
  const subpath = parts.slice(2).join('/')
  const packageDir = join(hostRoot, packageName)
  if (!subpath) {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    return join(packageDir, manifest.main ?? 'lib/index.js')
  }
  if (subpath === 'package.json') return join(packageDir, 'package.json')
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const exported = manifest.exports?.[`./${subpath}`]
  const target = typeof exported === 'string' ? exported : exported?.default
  return join(packageDir, target ?? subpath)
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@deepseek-ai/')) {
      return { url: pathToFileURL(hostFile(specifier)).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const hostPackage = JSON.parse(readFileSync(hostAnchor, 'utf8'))
result.host = {
  asar,
  dsh: hostPackage.version,
  cordis: JSON.parse(readFileSync(join(hostRoot, '@deepseek-ai/cordis/package.json'), 'utf8')).version,
  schemastery: JSON.parse(readFileSync(join(hostRoot, '@deepseek-ai/schemastery/package.json'), 'utf8')).version,
  node: process.version,
  electron: process.versions.electron,
}
check('official Desktop runtime is 0.2.2-rc.1', hostPackage.version === '0.2.2-rc.1', result.host)
check('official Cordis and schemastery match the audited contracts', result.host.cordis === '4.1.0' && result.host.schemastery === '3.19.0')

const moduleUrl = (name, file) => pathToFileURL(hostFile(file === undefined ? name : `${name}/${file}`)).href
const [
  appBoot,
  { Context },
  { SystemPrompt },
  { ToolsService },
  toolsModule,
  nativeExecutorModule,
  { LocalSubprocessRuntime },
  localBashModule,
  sandboxModule,
  llmModule,
  { OutputCollector },
  { GitBashSandboxExecutor },
  { mountPrivateExecutor, applyToolRouting, inlineNeeds },
  { createBashToolModule },
  { createNativeOutputAdapter },
  { createNativeToolModule },
  { createPathToolModule, convertMsysToNative },
  { pluginsFor },
  gitbash,
] = await Promise.all([
  import(moduleUrl('@deepseek-ai/dsh-app-boot')),
  import(moduleUrl('@deepseek-ai/cordis')),
  import(moduleUrl('@deepseek-ai/dsh-system-prompt')),
  import(moduleUrl('@deepseek-ai/dsh-tools')),
  import(moduleUrl('@deepseek-ai/dsh-tools')),
  import(moduleUrl('@deepseek-ai/dsh-tool-executor-native')),
  import(moduleUrl('@deepseek-ai/dsh-subprocess-local')),
  import(moduleUrl('@deepseek-ai/dsh-bash-local')),
  import(moduleUrl('@deepseek-ai/dsh-sandbox')),
  import(moduleUrl('@deepseek-ai/dsh-llm')),
  import(moduleUrl('@deepseek-ai/dsh-subprocess-local/output')),
  import('../src/shell.js'),
  import('../src/inline-tools.js'),
  import('../src/bash-tool.js'),
  import('../src/native-output.js'),
  import('../src/native-tool.js'),
  import('../src/path-tool.js'),
  import('../src/compositions.js'),
  import('../src/index.js'),
])

const manifest = JSON.parse(readFileSync(join(worktree, 'package.json'), 'utf8'))
check('installed package baseline remains 0.47.2', manifest.version === '0.47.2')
const compatibilityIssue = appBoot.evaluatePluginCompatibility(manifest, {}, appBoot.getDshRuntimeVersion())
result.observations.compatibilityIssue = compatibilityIssue ?? null
check('official engines.dsh evaluation accepts the baseline', compatibilityIssue === undefined, manifest.engines.dsh)

const modern = { timeContext: true, toolSchedule: true, pluginMarket: true, compaction: true, executorPlugin: true, profileContext: true }
const standardRows = pluginsFor({ kind: 'standard', hostExtras: modern })
const ptcRows = pluginsFor({ kind: 'ptc', hostExtras: modern })
const cordisRows = pluginsFor({ kind: 'cordis', hostExtras: modern })
const row = (rows, id) => {
  for (const entry of rows) {
    if (entry.id === id) return entry
    if (Array.isArray(entry.config)) {
      const nested = row(entry.config, id)
      if (nested) return nested
    }
  }
  return undefined
}
check('PTC uses the real PTC executor and folded subagent control', row(ptcRows, 'tool-executor-ptc')?.name === '@deepseek-ai/dsh-tool-executor-ptc'
  && row(ptcRows, 'tool-subagent-list-agents') === undefined
  && row(ptcRows, 'tool-subagent')?.config?.modelSelection === true
  && row(ptcRows, 'tool-subagent')?.config?.modelDiscovery === true)
check('standard/PTC manager and market gates mirror rc1', row(standardRows, 'tool-plugin-manager')?.disabled === undefined
  && row(standardRows, 'tool-plugin-market')?.disabled === true
  && row(ptcRows, 'tool-plugin-manager')?.disabled === true
  && row(ptcRows, 'tool-plugin-market')?.disabled === true
  && row(cordisRows, 'tool-plugin-manager')?.disabled === undefined
  && row(cordisRows, 'tool-plugin-market')?.disabled === undefined)
const withoutProfile = pluginsFor({ kind: 'cordis', hostExtras: { ...modern, profileContext: false } })
check('cordis manager/market stand down without profileContext', row(withoutProfile, 'tool-plugin-manager')?.disabled === true
  && row(withoutProfile, 'tool-plugin-market')?.disabled === true)
check('tool-fs applyPatch remains the official default false', row(standardRows, 'tool-fs')?.config?.applyPatch === undefined
  && toolsModule && JSON.parse(readFileSync(hostFile('@deepseek-ai/dsh-tool-fs/package.json'), 'utf8')).version === '0.2.2-rc.1')

const env = { home: 'C:/Users/Probe', tmpDir: 'C:/Temp', gitRoot: 'C:/Git' }
const translated = gitbash.translatePathArguments({
  file_path: '/c/Users/Probe/a b.txt',
  path: '/tmp',
  workdir: '/usr/bin',
  files: [{ path: '/c/Users/Probe/report.md' }],
}, env)
check('read/write/workdir/present argument translation', translated.file_path === 'C:/Users/Probe/a b.txt'
  && translated.path === 'C:/Temp'
  && translated.workdir === 'C:/Git/usr/bin'
  && translated.files[0].path === 'C:/Users/Probe/report.md', translated)
const glob = gitbash.translateGlobArguments({ pattern: '/c/Users/Probe/**/*.md' }, env)
check('absolute glob splits native path and relative pattern', glob.path === 'C:/Users/Probe' && glob.pattern === '**/*.md', glob)
const source = 'const p = "/c/Users/Probe/a.txt"; const n = "/dev/null"; const u = "https://example.invalid/c/keep"'
const rewritten = gitbash.rewriteCodePaths(source, env)
const rewrittenValues = Function(`${rewritten}; return [p, n, u]`)()
check('run_code literals translate only complete filesystem paths', rewrittenValues[0] === 'C:/Users/Probe/a.txt'
  && rewrittenValues[1] === '\\\\.\\NUL' && rewrittenValues[2] === 'https://example.invalid/c/keep', rewritten)
const conversion = convertMsysToNative('/usr/bin/bash.exe', { translate: value => gitbash.translateMsysPath(value, env), env })
check('explicit path conversion returns native_path data', conversion.ok === true && conversion.native_path === 'C:/Git/usr/bin/bash.exe', conversion)
check('explicit path conversion refuses unmapped POSIX guesses', convertMsysToNative('/unmapped/value', { translate: value => value, env }).code === 'NO_MOUNT_MAPPING')

let temp
let app
let executorScope
const fibers = []
let disposeRoutingSection
let removeAssembleListener
try {
  temp = mkdtempSync(join(tmpdir(), 'gitbash-rc1-compat-'))
  const profileDir = join(temp, 'profile')
  const modulesDir = join(profileDir, 'node_modules')
  mkdirSync(modulesDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({ name: 'gitbash-rc1-profile', private: true, dsh: { profile: { bundles: ['dsh-gitbash-shell'] } } }, null, 2)}\n`)
  const link = join(modulesDir, 'dsh-gitbash-shell')
  // Never link a disposable profile back into the real Git worktree: profile
  // cleanup must not be able to traverse into .git metadata on any filesystem.
  cpSync(worktree, link, { recursive: true, filter: source => !source.startsWith(join(worktree, '.git')) })
  assert.equal(readFileSync(join(link, 'package.json'), 'utf8'), readFileSync(join(worktree, 'package.json'), 'utf8'))
  const profile = appBoot.loadProfileDirectory('dsh-probe', profileDir, hostAnchor, { userLayer: false })
  result.observations.skippedBundles = profile.skippedBundles
  check('official profile loading has skippedBundles=[]', profile.skippedBundles.length === 0, profile.skippedBundles)

  app = new Context()
  const mount = async plugin => {
    const fiber = app.plugin(plugin)
    await fiber
    fibers.push(fiber)
    return fiber
  }
  const systemPrompt = new SystemPrompt(app, { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: '', personaSuffix: '' })
  const tools = new ToolsService(app)
  await mount(nativeExecutorModule)
  const fullPolicy = { mode: 'danger-full-access', workspaceRoot: temp }
  app.provide('sandboxPolicy', {
    defaultMode: 'danger-full-access',
    resolve: request => ({ ...fullPolicy, ...(request?.mode ? { mode: request.mode } : {}) }),
  })
  app.provide('sandbox', { confine: () => { throw new Error('confine must not run for danger-full-access') } })
  app.provide('shellEnv', { collect: () => ({ DSH_PATH_DIALECT: 'msys' }) })
  await mount(LocalSubprocessRuntime)

  const createScope = parent => {
    let childCtx
    const fiber = parent.plugin(c => { childCtx = c })
    return {
      fiber,
      get ctx() { return childCtx },
      dispose: async () => { try { await fiber?.dispose?.() } catch { /* already disposed */ } },
    }
  }
  const mounted = await mountPrivateExecutor(app, GitBashSandboxExecutor, createScope)
  executorScope = mounted.executorScope
  const executor = mounted.executor
  check('private executor exposes real Config and resolve/execute', typeof GitBashSandboxExecutor.Config === 'function'
    && typeof executor.config.timeoutMs?.get === 'function'
    && typeof executor.resolve === 'function' && typeof executor.execute === 'function')
  result.observations.shellIsolation = { rootShell: app.get('shell') ?? null, isolatedShellVisible: executorScope.ctx.get('shell') === executor }
  check('private shell isolation leaves the root official shell slot untouched', app.get('shell') === undefined, { isolatedShellVisible: result.observations.shellIsolation.isolatedShellVisible })
  const bashResolution = executor.bashResolution()
  result.observations.bashResolution = { ok: bashResolution.ok, path: bashResolution.path, source: bashResolution.source }
  check('real Git for Windows bash resolves', bashResolution.ok === true && existsSync(bashResolution.path), result.observations.bashResolution)
  const bashSpec = executor.resolve({ command: 'uname -s', workdir: temp, timeoutMs: 10000, onExpiry: 'kill', sandboxPolicy: fullPolicy })
  const bashResult = await (await executor.execute(bashSpec)).result()
  check('private executor really runs Git Bash', bashResult.exitCode === 0 && /^MINGW(?:32|64)_NT-/.test(bashResult.stdout.text.trim()), bashResult)
  const deniedMarker = join(temp, 'restricted-command-ran')
  let denial
  try {
    await executor.execute(executor.resolve({ command: `touch "${deniedMarker}"`, workdir: temp, timeoutMs: 10000, sandboxPolicy: { ...fullPolicy, mode: 'read-only' } }))
  } catch (error) { denial = error }
  check('restricted policy fails closed before process start', denial?.code === 'SANDBOX_UNAVAILABLE' && !existsSync(deniedMarker), { code: denial?.code, name: denial?.name })

  const logs = []
  const log = message => logs.push(message)
  const bashModule = createBashToolModule({ executor, toolsModule, sandboxModule, llmModule, log })
  await mount(bashModule)
  const bashDefinition = tools.get('bash')
  check('own bash module registers through real Cordis/tools', typeof bashDefinition?.execute === 'function')
  const ownBashValue = await bashDefinition.execute({ command: 'printf own-bash-ok', description: 'Verify own bash registration', workdir: temp, timeoutMs: 10000 }, { signal: new AbortController().signal })
  check('own bash executes through the private executor', ownBashValue.kind === 'foreground' && ownBashValue.exitCode === 0 && ownBashValue.stdout.text === 'own-bash-ok')
  check('own bash output satisfies its real output schema', toolsModule.validateJsonSchemaValue(bashDefinition.output.schema, ownBashValue).length === 0)
  check('inline face detection still adds bash only for pwsh-only faces', inlineNeeds(['pwsh']).needsBash === true && inlineNeeds(['bash', 'pwsh']).needsBash === false)

  const nativeModule = createNativeToolModule({
    toolsModule, sandboxModule, localBashModule, createScope,
    translateMsysPath: value => gitbash.translateMsysPath(value, env),
    createNativeOutputAdapter, outputOptions: { OutputCollector },
    createArtifactDirectory: () => mkdtempSync(join(temp, 'native-artifacts-')),
    experimentalEnabled: () => true, log, scope: undefined,
  })
  await mount(nativeModule)
  const nativeDefinition = tools.get('gitbash_native')
  check('native companion registers through real Cordis/tools', typeof nativeDefinition?.execute === 'function')
  const script = 'console.log(JSON.stringify(process.argv.slice(1)))'
  const nativeValue = await nativeDefinition.execute({
    description: 'Probe exact native argv and encodings',
    executable: { kind: 'path', value: process.env.DSH_TEST_NODE ?? 'C:/Program Files/nodejs/node.exe' },
    entrypoint: 'interpreter',
    argv: [
      { kind: 'literal', value: '-e' }, { kind: 'literal', value: script },
      { kind: 'literal', value: '/all' }, { kind: 'literal', value: '' },
      { kind: 'literal', value: '/c' }, { kind: 'path', value: '/c/Users/Probe/a b.txt' },
    ],
    cwd: { kind: 'path', value: temp }, timeoutMs: 10000,
    stdoutEncoding: 'utf8', stderrEncoding: 'utf8', errors: 'strict',
  }, { signal: new AbortController().signal })
  const argv = JSON.parse(nativeValue.stdout.text)
  check('native executor preserves literal argv and translates only typed paths', nativeValue.exitCode === 0
    && argv[0] === '/all' && argv[1] === '' && argv[2] === '/c' && argv[3] === 'C:\\Users\\Probe\\a b.txt', { argv, nativeValue })
  check('native result carries real exit and output facts', nativeValue.status === 'completed'
    && nativeValue.outputFacts?.stdout?.encoding === 'utf-8'
    && nativeValue.outputFacts?.stdout?.complete === true
    && toolsModule.validateJsonSchemaValue(nativeDefinition.output.schema, nativeValue).length === 0)
  const utf16Value = await nativeDefinition.execute({
    description: 'Probe nonzero exit and UTF-16LE output',
    executable: { kind: 'path', value: process.env.DSH_TEST_NODE ?? 'C:/Program Files/nodejs/node.exe' },
    entrypoint: 'interpreter',
    argv: [
      { kind: 'literal', value: '-e' },
      { kind: 'literal', value: 'process.stdout.write(Buffer.from([109,0,105,0,110,0,103,0,119,0,51,0,50,0,10,0])); process.exitCode = 23' },
    ],
    cwd: { kind: 'path', value: temp }, timeoutMs: 10000,
    stdoutEncoding: 'utf16le', stderrEncoding: 'utf8', errors: 'strict',
  }, { signal: new AbortController().signal })
  check('native nonzero exit and declared UTF-16LE output survive independently', utf16Value.exitCode === 23
    && utf16Value.stdout.text === 'mingw32\n'
    && utf16Value.outputFacts?.stdout?.encoding === 'utf-16le'
    && utf16Value.outputFacts?.stdout?.reliableText === true
    && utf16Value.outputFacts?.stdout?.complete === true, utf16Value)

  const pathModule = createPathToolModule({
    toolsModule, translate: value => gitbash.translateMsysPath(value, env), experimentalEnabled: () => true, log,
  })
  await mount(pathModule)
  const pathDefinition = tools.get('gitbash_to_native_path')
  const converted = await pathDefinition.execute({ msys_path: '/usr/bin/bash.exe' }, {})
  check('path companion registers and executes through real defineTool', converted.native_path === 'C:/Git/usr/bin/bash.exe')

  // Register the production routing-section renderer against the real host.
  disposeRoutingSection = systemPrompt.section({
    name: 'gitbash-shell:tool-routing',
    order: 1005,
    text: context => gitbash.toolRoutingSectionText(
      app.get('tools').schemas(context.agent, context.toolSet),
      { pwshVisible: false, msys: true },
    ),
  })
  // Reproduce the legacy listener separately to demonstrate why the modern
  // section is required: schemas() is detached from the final provider tools.
  let offeredRouting = false
  let toolsOnWaterfall
  removeAssembleListener = app.on('system-prompt/assemble', (assembly, context, next) => {
    toolsOnWaterfall = Array.isArray(assembly.tools)
    const offered = app.get('tools').schemas(context.agent, context.toolSet)
    applyToolRouting(offered, { pwshVisible: false, msys: true })
    offeredRouting = offered.find(tool => tool.name === 'bash')?.description.includes('[gitbash tool routing]') === true
    return next()
  })
  const assembled = await systemPrompt.assemble({})
  result.observations.promptRouting = {
    toolsOnWaterfall,
    offeredRouting,
    finalRouting: assembled.tools.find(tool => tool.name === 'bash')?.description.includes('[gitbash tool routing]') === true,
    sectionRouting: assembled.sections.some(section => section.text.includes('[gitbash tool routing]')),
  }
  console.log(`OBSERVE promptRouting=${JSON.stringify(result.observations.promptRouting)}`)
  check('modern routing guidance reaches the final prompt through a real section', toolsOnWaterfall === false
    && offeredRouting === true
    && result.observations.promptRouting.finalRouting === false
    && result.observations.promptRouting.sectionRouting === true, result.observations.promptRouting)

  result.ok = Object.values(result.checks).every(Boolean)
  result.summary = { passed: Object.values(result.checks).filter(Boolean).length, failed: Object.values(result.checks).filter(value => !value).length }
  save()
  console.log(`RC1-COMPAT ${JSON.stringify(result.summary)}`)
} catch (error) {
  result.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
  result.ok = false
  save()
  console.error(error)
  process.exitCode = 1
} finally {
  let cleanShutdown = true
  try { removeAssembleListener?.() } catch (error) { cleanShutdown = false; result.listenerCleanupError = String(error) }
  try { disposeRoutingSection?.() } catch (error) { cleanShutdown = false; result.sectionCleanupError = String(error) }
  try { await executorScope?.dispose() } catch (error) { cleanShutdown = false; result.executorCleanupError = String(error) }
  const cleanupErrors = []
  for (const fiber of fibers.splice(0).reverse()) {
    try { await fiber.dispose() } catch (error) { cleanShutdown = false; cleanupErrors.push(String(error)) }
  }
  if (cleanupErrors.length) result.fiberCleanupErrors = cleanupErrors
  result.observations.cleanShutdown = cleanShutdown
  if (!cleanShutdown) { result.ok = false; process.exitCode = 1 }
  if (temp) {
    try { rmSync(temp, { recursive: true, force: true }) } catch { /* own temp cleanup */ }
  }
  save()
}
