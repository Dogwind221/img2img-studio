#!/usr/bin/env node
/**
 * 把 tsdown 折叠成多行的 banner 头压回一行。
 *
 * 契约要求 `lib/client.js` 以
 *   `window.__ModuleLoader__.load({ id: "<package name>", factory: (require) => {`
 * 精确开头（客户端启动时按这个前缀识别包身份）；tsdown 会把它美化换行，
 * 所以打包后必须归一化一次。
 */
import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = join(root, 'lib', 'client.js')
const name = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).name
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`

const code = fs.readFileSync(bundle, 'utf8')
if (code.startsWith(required)) {
  console.log('normalize-client-banner: already normalized')
  process.exit(0)
}

const lines = code.split('\n')
const head = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(name)},`,
  '\tfactory: (require) => {',
]
if (lines[0] !== head[0] || lines[1] !== head[1] || lines[2] !== head[2]) {
  console.error(`normalize-client-banner: unexpected lib/client.js header:\n` + lines.slice(0, 3).join('\n'))
  process.exit(1)
}
lines[0] = required
lines[1] = ''
lines[2] = ''
fs.writeFileSync(bundle, lines.join('\n'))
console.log('normalize-client-banner: ok')
