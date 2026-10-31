#!/usr/bin/env node
/**
 * 把插件构建产物同步到「已安装技能」目录，解决仓库与 ~/.agents/skills 的漂移。
 *
 * 目标：新装/重装技能的人拿到的 `plugins/dsh-img2img-config` 与仓库当前构建一致。
 *
 * 做四件事：
 *  1. 跑 scripts/build.mjs（host tsc + client typecheck + tsdown + banner）；
 *  2. 把插件包（package.json / cordis.patch.yml / lib / src / scripts / 配置）覆盖到
 *     <skills>/img2img-studio/plugins/dsh-img2img-config；
 *  3. 把仓库根部的 SKILL.md / README.md / CHANGELOG.md 同步过去；
 *  4. 用 tar 重打 `dsh-img2img-config-<version>.tgz`，删掉旧版本 tgz。
 *
 * 不动技能根部的 scripts/ references/ engines/（线上那份可能比仓库新，属于用户运行时资产）。
 *
 * 用法：
 *   node scripts/sync-skill.mjs
 *   DSH_SKILLS_DIR=... IMG2IMG_SKILL_DIR=... node scripts/sync-skill.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(pluginRoot, '..', '..')
const skillsRoot = process.env.DSH_SKILLS_DIR
  ? resolve(process.env.DSH_SKILLS_DIR)
  : join(homedir(), '.agents', 'skills')
const skillDir = process.env.IMG2IMG_SKILL_DIR
  ? resolve(process.env.IMG2IMG_SKILL_DIR)
  : join(skillsRoot, 'img2img-studio')
const target = join(skillDir, 'plugins', 'dsh-img2img-config')

if (!existsSync(skillDir)) {
  console.error(`未找到已安装技能目录：${skillDir}`)
  console.error('先安装技能，或用 IMG2IMG_SKILL_DIR 指定目录。')
  process.exit(1)
}

console.log(`=== 1/4 构建插件（${pluginRoot}）===`)
execFileSync(process.execPath, [join(pluginRoot, 'scripts', 'build.mjs')], { stdio: 'inherit', cwd: pluginRoot })

console.log(`\n=== 2/4 同步插件包 → ${target} ===`)
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
const FILES = ['package.json', 'cordis.patch.yml', 'manifest.schema.json', 'README.md', '.gitignore', 'tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts']
for (const file of FILES) {
  const source = join(pluginRoot, file)
  if (existsSync(source)) copyFileSync(source, join(target, file))
}
const DIRS = ['lib', 'src', 'scripts']
for (const dir of DIRS) {
  const source = join(pluginRoot, dir)
  if (!existsSync(source)) continue
  cpSync(source, join(target, dir), {
    recursive: true,
    filter: (path) => !path.includes('node_modules') && !/\.bak/.test(path) && !path.endsWith('.tgz'),
  })
}

console.log('\n=== 3/4 同步技能文档（不改运行时 scripts/ references/ engines/）===')
for (const file of ['SKILL.md', 'README.md', 'CHANGELOG.md']) {
  const source = join(repoRoot, file)
  if (!existsSync(source)) continue
  copyFileSync(source, join(skillDir, file))
  console.log(`  ✓ ${file}`)
}

console.log('\n=== 4/4 重打 tgz ===')
const version = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).version
for (const entry of readdirSync(target)) {
  if (entry.endsWith('.tgz')) rmSync(join(target, entry), { force: true })
}
const tgz = join(target, `dsh-img2img-config-${version}.tgz`)
try {
  execFileSync('tar', ['-czf', tgz, '-C', pluginRoot, 'package.json', 'cordis.patch.yml', 'manifest.schema.json', 'lib', 'src'], { stdio: 'inherit' })
  console.log(`  ✓ ${tgz}`)
} catch (error) {
  console.warn(`  ! tar 打包失败（目录已同步，不影响使用）：${error.message}`)
}

const hash = (file) => existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12) : 'missing'
const repoClient = join(pluginRoot, 'lib', 'client.js')
const targetClient = join(target, 'lib', 'client.js')
console.log('\n=== 校验 ===')
console.log(`  repo   lib/client.js sha256:${hash(repoClient)}`)
console.log(`  skill  lib/client.js sha256:${hash(targetClient)}`)
console.log(`  version ${version}`)
console.log(hash(repoClient) === hash(targetClient) ? '\nOK：仓库与已安装技能插件一致' : '\nWARN：两处 client.js 不一致，检查同步结果')
