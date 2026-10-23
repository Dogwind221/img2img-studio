/**
 * .env 读写工具：读取/合并写回识图与生图 skill 的 .env 配置文件。
 *
 * 面板同时服务两个 skill，而用户可能只装了其中一个：写盘前必须先把目标目录
 * 建出来，否则 writeFileSync 会以 ENOENT 失败，把整次「保存」连带弄挂。
 */
export type EnvMap = Record<string, string>;
/** 识图与生图 skill 的 .env 路径（~/.agents/skills/...） */
export declare function skillEnvPath(kind: 'vision' | 'gen'): string;
/** 解析 .env 文本为键值表（保留文件原样，仅解析行） */
export declare function parseEnv(text: string): EnvMap;
/** 读取 .env（不存在返回空表） */
export declare function readEnv(file: string): EnvMap;
/**
 * 合并写回 .env：
 *  - updates[k] === undefined/null → 保持原值
 *  - updates[k] === '' → 删除该行
 *  - 其他 → upsert
 */
export declare function writeEnv(file: string, updates: EnvMap): EnvMap;
