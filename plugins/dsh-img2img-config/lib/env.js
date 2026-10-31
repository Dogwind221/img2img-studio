/**
 * .env 读写工具：读取/合并写回识图与生图 skill 的 .env 配置文件。
 *
 * 面板同时服务两个 skill，而用户可能只装了其中一个：写盘前必须先把目标目录
 * 建出来，否则 writeFileSync 会以 ENOENT 失败，把整次「保存」连带弄挂。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** 识图与生图 skill 的 .env 路径（~/.agents/skills/...） */
export function skillEnvPath(kind) {
    const skills = process.env.DSH_SKILLS_DIR
        ? join(process.env.DSH_SKILLS_DIR)
        : join(homedir(), '.agents', 'skills');
    return kind === 'vision'
        ? join(skills, 'dsh-vision-skill', 'scripts', '.env')
        : join(skills, 'img2img-studio', 'scripts', '.env');
}
/** 解析 .env 文本为键值表（保留文件原样，仅解析行） */
export function parseEnv(text) {
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#'))
            continue;
        const eq = line.indexOf('=');
        if (eq <= 0)
            continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key)
            out[key] = val;
    }
    return out;
}
/** 读取 .env（不存在返回空表） */
export function readEnv(file) {
    if (!existsSync(file))
        return {};
    return parseEnv(readFileSync(file, 'utf8'));
}
/**
 * 合并写回 .env：
 *  - updates[k] === undefined/null → 保持原值
 *  - updates[k] === '' → 删除该行
 *  - 其他 → upsert
 */
export function writeEnv(file, updates) {
    const current = {};
    const lines = [];
    if (existsSync(file)) {
        const text = readFileSync(file, 'utf8');
        // 末尾换行会 split 出一个空串；先摘掉，否则每次重写都会多长一行空行。
        const rawLines = text.split(/\r?\n/);
        if (rawLines[rawLines.length - 1] === '')
            rawLines.pop();
        for (const raw of rawLines) {
            const line = raw.trim();
            const eq = line.indexOf('=');
            if (eq > 0) {
                const key = line.slice(0, eq).trim();
                if (key && key in updates) {
                    const v = updates[key];
                    if (v === undefined || v === null) {
                        current[key] = readEnv(file)[key] ?? '';
                        lines.push(raw);
                        continue;
                    }
                    if (v === '') {
                        current[key] = '';
                        continue;
                    } // 删除
                    current[key] = v;
                    lines.push(`${key}=${v}`);
                    continue;
                }
                if (eq > 0) {
                    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
                    current[key] = val;
                }
                lines.push(raw);
                continue;
            }
            lines.push(raw);
        }
    }
    // 新增键
    for (const [k, v] of Object.entries(updates)) {
        if (v === undefined || v === null)
            continue;
        if (v === '') {
            delete current[k];
            continue;
        }
        if (!(k in current)) {
            current[k] = v;
            lines.push(`${k}=${v}`);
        }
    }
    // 内容没变就不碰磁盘：探测/测试会反复 syncEnv，避免无意义的 mtime 变更与写 I/O。
    const nextText = lines.join('\n') + '\n';
    if (existsSync(file) && readFileSync(file, 'utf8') === nextText)
        return current;
    mkdirSync(dirname(file), { recursive: true });
    // 先写同目录临时文件再 rename：进程被杀/写一半时不会留下半截 .env。
    const temporary = `${file}.tmp-${process.pid.toString(36)}-${Date.now().toString(36)}`;
    writeFileSync(temporary, nextText, 'utf8');
    try {
        renameSync(temporary, file);
    }
    catch (error) {
        rmSync(temporary, { force: true });
        throw error;
    }
    return current;
}
//# sourceMappingURL=env.js.map