#!/usr/bin/env node
/**
 * 降级链 mock 回归（不联网、不花钱）：
 * 起一个本地 mock HTTP 服务——`local` 通道固定 429，`openai` 通道固定 200，
 * 在隔离子进程里跑 generate_image.mjs --provider auto，断言：
 *  - 429 后自动切到备选并成功（主/备降级链真实生效）；
 *  - JSON 输出 provider=openai、fallbackDepth=1、attempts=2（--retries 0）。
 *
 * 用法：node scripts/verify-fallback.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./generate_image.mjs', import.meta.url))
/** 1×1 透明 PNG，足够让 saveImages 落盘并返回文件名。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
let localHits = 0
let openaiHits = 0

const server = createServer((request, response) => {
  request.resume()
  request.on('end', () => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname.startsWith('/local/')) {
      localHits += 1
      response.writeHead(429, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'rate limit reached for requests', type: 'rate_limit' } }))
      return
    }
    if (pathname.startsWith('/openai/')) {
      openaiHits += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{}')
  })
})
await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
const { port } = server.address()
const work = mkdtempSync(join(tmpdir(), 'img2img-fallback-'))
const home = join(work, 'home')
mkdirSync(home, { recursive: true })

const child = spawn(process.execPath, [
  script, '--prompt', 'p1 fallback mock', '--quality', 'normal', '--retries', '0',
  '--output-dir', join(work, 'out'), '--json',
], {
  cwd: work,
  env: {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    DSH_SKILLS_DIR: join(work, 'skills'),
    IMG_HTTP_URL: `http://127.0.0.1:${port}/local`,
    IMG_BASE_URL: `http://127.0.0.1:${port}/openai`,
    IMG_API_KEY: 'test-key',
    IMG_MODEL: 'gpt-image-2',
    GEN_PROVIDER_ORDER: 'local,openai',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })
const code = await new Promise((resolve) => { child.on('close', resolve) })
server.close()

let result
const firstBrace = stdout.indexOf('{')
const lastBrace = stdout.lastIndexOf('}')
if (firstBrace >= 0 && lastBrace > firstBrace) {
  try {
    result = JSON.parse(stdout.slice(firstBrace, lastBrace + 1))
  } catch { /* 解析失败在下面的断言里报出 */ }
}

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`)
}
check('子进程退出码 0', code === 0, `exit=${code}; stdout=${stdout.slice(0, 300)}; stderr=${stderr.slice(-400)}`)
check('429 后自动切到备选通道并成功', result?.ok === true && result.provider === 'openai', JSON.stringify(result))
check('fallbackDepth = 1（首选 local 失败，第 2 个通道 openai 成功）', result?.fallbackDepth === 1, String(result?.fallbackDepth))
check('attempts = 2（每通道 1 次，--retries 0）', result?.attempts === 2, String(result?.attempts))
check('mock 收到 local 429 与 openai 200 各一次', localHits === 1 && openaiHits === 1, `local=${localHits} openai=${openaiHits}`)
check('生成了 1 个结果文件', Array.isArray(result?.files) && result.files.length === 1, JSON.stringify(result?.files))

rmSync(work, { recursive: true, force: true })
if (failures.length > 0) {
  console.error(`\nverify-fallback: ${failures.length} 项失败`)
  process.exit(1)
}
console.log('\nverify-fallback: 6 项全部通过')
