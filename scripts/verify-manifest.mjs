#!/usr/bin/env node
/**
 * manifest 契约回归（不联网）：
 *  - manifest.schema.json 是合法 JSON、version 固定 1；
 *  - 技能脚本 edit_image.mjs manifest 按 version 1 校验：未知版本 / 坐标越界 / 缺 files.edited 都要拒绝；
 *  - 合法 manifest 能正常解析并输出 op=manifest 结果。
 *
 * 用法：node scripts/verify-manifest.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./edit_image.mjs', import.meta.url))
const schemaPath = fileURLToPath(new URL('../plugins/dsh-img2img-config/manifest.schema.json', import.meta.url))
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const work = mkdtempSync(join(tmpdir(), 'img2img-manifest-'))

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'ok  ' : 'fail'} ${name}${ok ? '' : ` — ${detail}`}`)
}

const run = (args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('close', (code) => resolve({ code, stdout, stderr }))
})

try {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  check('schema 是合法 JSON 且 version 固定为 1', schema.properties?.version?.const === 1, JSON.stringify(schema.properties?.version))
  check('schema 要求 files.edited 与 0–1 坐标', schema.required?.includes('files') === true && schema.properties?.markers?.items?.properties?.x?.maximum === 1, 'schema 字段缺失')

  const baseImage = join(work, 'edited-1.png')
  writeFileSync(baseImage, PNG)
  const writeManifest = (name, manifest) => {
    const file = join(work, name)
    writeFileSync(file, JSON.stringify(manifest))
    return file
  }

  const unknownVersion = writeManifest('v2.json', { version: 2, files: { edited: 'edited-1.png' } })
  const v2 = await run(['manifest', '--manifest', unknownVersion, '--out-dir', join(work, 'out-v2')])
  check('未知 version 2 被拒绝并提示升级插件', v2.code !== 0 && /version 必须是 1/.test(v2.stderr + v2.stdout), `${v2.code}: ${(v2.stderr + v2.stdout).slice(0, 200)}`)

  const badCoord = writeManifest('bad-coord.json', { version: 1, files: { edited: 'edited-1.png' }, markers: [{ id: 1, x: 1.4, y: 0.2, text: 'x' }] })
  const bad = await run(['manifest', '--manifest', badCoord, '--out-dir', join(work, 'out-bad')])
  check('坐标越界被拒绝', bad.code !== 0 && /归一化坐标/.test(bad.stderr + bad.stdout), `${bad.code}: ${(bad.stderr + bad.stdout).slice(0, 200)}`)

  const noBase = writeManifest('no-base.json', { version: 1, files: {} })
  const missing = await run(['manifest', '--manifest', noBase, '--out-dir', join(work, 'out-missing')])
  check('缺 files.edited 被拒绝', missing.code !== 0 && /files\.edited/.test(missing.stderr + missing.stdout), `${missing.code}: ${(missing.stderr + missing.stdout).slice(0, 200)}`)

  const good = writeManifest('good.json', {
    version: 1,
    createdAt: new Date().toISOString(),
    source: { name: 'a.png', width: 1, height: 1 },
    size: { width: 1, height: 1, mode: 'cover', changed: true },
    bgRemove: { requested: false, localPreview: false, tolerance: 36 },
    erase: { strokes: 0, prompt: '' },
    markers: [{ id: 1, x: 0.5, y: 0.5, text: '改成红色' }],
    files: { edited: 'edited-1.png' },
  })
  const ok = await run(['manifest', '--manifest', good, '--out-dir', join(work, 'out-ok'), '--json'])
  check('合法 manifest 被接受并输出 op=manifest', ok.code === 0 && /"op": "manifest"/.test(ok.stdout), `${ok.code}: ${ok.stdout.slice(0, 200)}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\nverify-manifest: ${failures.length} 项失败`)
  process.exit(1)
}
console.log('\nverify-manifest: 6 项全部通过')
