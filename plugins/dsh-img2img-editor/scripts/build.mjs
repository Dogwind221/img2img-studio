#!/usr/bin/env node
/**
 * Node port of scripts/build.sh for hosts where bash cannot fork (the DSH file
 * sandbox blocks the signal pipe bash needs on Windows).
 *
 * Steps: locate the dsh checkout → link the few build-time dependencies it
 * provides → compile the host half with its tsc → typecheck the client half →
 * bundle lib/client.js with its tsdown.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

/** dsh checkout probe: env → this workspace's known checkouts → conventional homes. */
function detectCheckout() {
  const candidates = [
    process.env.DSH_CHECKOUT,
    'F:/dsh/_rc2-src',
    'F:/dsh',
    join(homedir(), 'dsh-harness'),
    join(homedir(), 'dsh'),
    join(homedir(), '.dsh', 'dsh-harness'),
  ].filter(candidate => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'packages'))) return resolve(candidate)
  }
  return ''
}

/** One entry of the checkout's pnpm store. */
function findPnpm(pattern) {
  const store = join(checkout, 'node_modules', '.pnpm')
  if (!existsSync(store)) return ''
  const match = readdirSync(store).find(name => name.toLowerCase().startsWith(pattern))
  return match === undefined ? '' : join(store, match)
}

/** Junction (Windows) or symlink link into node_modules. */
function linkDir(name, target) {
  if (!existsSync(target)) {
    console.log(`build: skip ${name} (missing ${target})`)
    return
  }
  const link = join(root, 'node_modules', name)
  rmSync(link, { recursive: true, force: true })
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Run one child with inherited stdio, failing the build on a non-zero exit. */
function run(command, args, label) {
  console.log(`=== ${label} ===`)
  execFileSync(command, args, { stdio: 'inherit', cwd: root })
}

const checkout = detectCheckout()
if (checkout === '') {
  console.error('build: cannot locate the dsh checkout (set DSH_CHECKOUT)')
  process.exit(1)
}
console.log(`=== Linking build dependencies (checkout: ${checkout}) ===`)
linkDir('@types/node', join(checkout, 'node_modules', '@types', 'node'))
const tsdown = findPnpm('tsdown@')
if (tsdown !== '') linkDir('tsdown', join(tsdown, 'node_modules', 'tsdown'))
const reactTypes = findPnpm('@types+react@18')
if (reactTypes !== '') linkDir('@types/react', join(reactTypes, 'node_modules', '@types', 'react'))

// npm run resolves only node_modules/.bin: copy the checkout's tsdown shim,
// whose relative %~dp0\..\tsdown path hits the junction created above.
const binSource = join(checkout, 'node_modules', '.bin')
if (existsSync(join(binSource, 'tsdown.cmd'))) {
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
  for (const file of ['tsdown', 'tsdown.cmd', 'tsdown.ps1']) {
    if (existsSync(join(binSource, file))) {
      copyFileSync(join(binSource, file), join(root, 'node_modules', '.bin', file))
    }
  }
}

const tsc = join(checkout, 'node_modules', 'typescript', 'bin', 'tsc')
run(process.execPath, [tsc, '-p', 'tsconfig.json'], 'Compiling host half (src/index.ts) -> lib')
if (existsSync(join(root, 'node_modules', '@types', 'react'))) {
  run(process.execPath, [tsc, '-p', 'tsconfig.client.json'], 'Typechecking client half (no emit)')
}
const tsdownBin = join(root, 'node_modules', 'tsdown', 'dist', 'run.mjs')
if (existsSync(tsdownBin)) {
  run(process.execPath, [tsdownBin], 'Bundling client half -> lib/client.js')
} else {
  console.log('build: tsdown unavailable; skipped lib/client.js')
}
console.log('=== Build complete ===')
