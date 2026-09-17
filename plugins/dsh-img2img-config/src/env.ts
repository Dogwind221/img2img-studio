/**
 * .env 读写工具：读取/合并写回识图与生图 skill 的 .env 配置文件。
 *
 * 面板同时服务两个 skill，而用户可能只装了其中一个：写盘前必须先把目标目录
 * 建出来，否则 writeFileSync 会以 ENOENT 失败，把整次「保存」连带弄挂。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type EnvMap = Record<string, string>

/** 识图与生图 skill 的 .env 路径（~/.agents/skills/...） */
export function skillEnvPath(kind: 'vision' | 'gen'): string {
  const skills = process.env.DSH_SKILLS_DIR
    ? join(process.env.DSH_SKILLS_DIR)
    : join(homedir(), '.agents', 'skills')
  return kind === 'vision'
    ? join(skills, 'dsh-vision-skill', 'scripts', '.env')
    : join(skills, 'img2img-studio', 'scripts', '.env')
}

/** 解析 .env 文本为键值表（保留文件原样，仅解析行） */
export function parseEnv(text: string): EnvMap {
  const out: EnvMap = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key) out[key] = val
  }
  return out
}

/** 读取 .env（不存在返回空表） */
export function readEnv(file: string): EnvMap {
  if (!existsSync(file)) return {}
  return parseEnv(readFileSync(file, 'utf8'))
}

/**
 * 合并写回 .env：
 *  - updates[k] === undefined/null → 保持原值
 *  - updates[k] === '' → 删除该行
 *  - 其他 → upsert
 */
export function writeEnv(file: string, updates: EnvMap): EnvMap {
  const current: EnvMap = {}
  const lines: string[] = []
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      const eq = line.indexOf('=')
      if (eq > 0) {
        const key = line.slice(0, eq).trim()
        if (key && key in updates) {
          const v = updates[key]
          if (v === undefined || v === null) { current[key] = readEnv(file)[key] ?? ''; lines.push(raw); continue }
          if (v === '') { current[key] = ''; continue } // 删除
          current[key] = v
          lines.push(`${key}=${v}`)
          continue
        }
        if (eq > 0) {
          const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
          current[key] = val
        }
        lines.push(raw)
        continue
      }
      lines.push(raw)
    }
  }
  // 新增键
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null) continue
    if (v === '') { delete current[k]; continue }
    if (!(k in current)) {
      current[k] = v
      lines.push(`${k}=${v}`)
    }
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n') + '\n', 'utf8')
  return current
}
