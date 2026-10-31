/**
 * 双端共用的「供应商目录」+「.env 同步计划器」。
 *
 * 同一份数据被两个 bundle 使用：
 *  - host（src/index.ts）：保存时用 planSync() 生成两份 .env 的写入计划；
 *  - client（src/client/config-panel.tsx）：「添加通道」选择弹层用 CATALOG，
 *    保存前预览用同一个 planSync()。
 *
 * 纯数据 + 纯函数：不 import node / react，tsc（host）与 tsdown（browser）都能编。
 *
 * 关键约束：生图侧的 providerId 必须与 img2img-studio/scripts/generate_image.mjs
 * 的 detectProviders() 完全一致（openai/dashscope/zai/seedream/minimax/qoder/
 * codex-cli/direct/chatgpt-web@<账号id>），否则 GEN_PROVIDER_ORDER 会被脚本忽略。
 * 旧的「模板 id + 时间戳」就是因此失效的；channel 的唯一性改由 id 承担，
 * providerId 永远是脚本认的那个 id。
 */
/** 通道所属技能半边。 */
export type ProviderKind = 'vision' | 'gen';
/** 余额探测状态。 */
export type ProviderStatus = 'ok' | 'arrears' | 'error' | 'unknown' | 'cli';
/** 一条已配置的通道（持久化在 ~/.dsh/dsh-img2img-config/providers.json）。 */
export interface ProviderItem {
    /** 通道 id（行主键）。新通道优先用 providerId，重复添加时用 `providerId#2`。 */
    id: string;
    /** 脚本 provider id（generate_image.mjs / vision.js 认的值）。旧数据由 id 推导。 */
    providerId?: string;
    name: string;
    kind: ProviderKind;
    level: 1 | 2 | 3;
    enabled: boolean;
    apiKey: string;
    model: string;
    base: string;
    /** 仅 providerId === 'direct'：直连引擎的子通道，写入 DIRECT_PROVIDER。 */
    directProvider?: string;
    /** 仅客户端使用：保存时要求宿主清空该通道已存的 Key（空 key 默认是「保持原值」）。 */
    clearKey?: boolean;
    /** 最近一次探测/测试的说明（人类可读，例如「HTTP 200」「未检测到 qoderclicn」）。 */
    detail?: string;
    status: ProviderStatus;
    lastChecked: number | null;
}
/** 认证方式：API Key / 本机 CLI 登录态 / 账号库（ChatGPT 网页、Codex）。 */
export type ProviderAuth = 'apiKey' | 'cli' | 'account';
/** 生图侧 provider → .env 变量映射（识图侧的 key 走 VISION_PROVIDERS，不在此列）。 */
export interface CatalogEnv {
    key?: string;
    model?: string;
    base?: string;
}
export interface DirectSubProvider {
    id: string;
    name: string;
}
export interface CatalogEntry {
    providerId: string;
    name: string;
    /** 该供应商可用于哪种通道；dashscope/openai/zai 同时是识图与生图供应商。 */
    kinds: readonly ProviderKind[];
    auth: ProviderAuth;
    base: string;
    /** 生图模型建议（chips）。 */
    models: readonly string[];
    /** 识图模型建议（chips）；缺省回退 models。 */
    visionModels?: readonly string[];
    /** 生图侧 .env 映射；无 key/base/model 可写时省略。 */
    env?: CatalogEnv;
    /** 图生图能力：yes=支持参考图，no=不支持，subject=主体参考，direct=看子通道。 */
    i2i?: 'yes' | 'no' | 'subject' | 'direct';
    note?: string;
    subProviders?: readonly DirectSubProvider[];
}
/** 直连引擎（engines/direct-api）的子通道，与脚本 DIRECT_PROVIDERS 同源。 */
export declare const DIRECT_SUB_PROVIDERS: readonly DirectSubProvider[];
/**
 * 供应商目录（单一真源）。
 *
 * 面板「添加通道」直接按这里的条目生成选项；宿主按 env 字段写 .env；
 * hostVersion 跟着目录协议走，旧宿主没有该字段时面板会提示重启。
 */
export declare const CATALOG: readonly CatalogEntry[];
/** 目录协议版本：宿主在 GET /providers 里回传，旧宿主没有该字段。 */
export declare const HOST_PROTOCOL_VERSION = 2;
/** 生图 provider id 白名单（脚本 detectProviders() 的 id）。 */
export declare const GEN_PROVIDER_IDS: readonly string[];
/** 识图目录 id（识图侧允许目录外的自定义 id，仅用于提示）。 */
export declare const VISION_PROVIDER_IDS: readonly string[];
export declare function catalogEntry(providerId: string): CatalogEntry | undefined;
/** 生图通道的 providerId 是否会被 generate_image.mjs 识别。 */
export declare function isGenProviderId(providerId: string): boolean;
export declare function catalogModels(providerId: string, kind: ProviderKind): readonly string[];
export declare function authFor(providerId: string): ProviderAuth;
/** 凭据由账号库 / 本机登录态托管，面板不显示 Key 输入框。 */
export declare function isManagedProvider(providerId: string): boolean;
export declare function managedReason(providerId: string): string;
export declare function isAccountProvider(providerId: string): boolean;
/** 把历史 id 归一化成脚本 provider id。 */
export declare function normalizeProviderId(rawId: string): string;
/** 通道行的真实 provider id（新数据取 providerId，旧数据从 id 推导）。 */
export declare function providerIdOf(provider: ProviderItem): string;
/** 新通道 id：providerId 未被占用就直接用，重复添加用 `providerId#2`。 */
export declare function channelIdFor(providerId: string, taken: ReadonlySet<string>): string;
/** 键值是否已经打码（预览/回传场景不当作新 Key）。 */
export declare function isMaskedValue(value: string): boolean;
/** 宿主从 ChatGPT 账号库投影给纯函数的最小字段。 */
export interface AccountLike {
    id: string;
    label: string;
    /** 账号档位展示名（如「免费 Free」），拼进通道名。 */
    planLabel?: string;
    /** ChatGPT 账号 UUID（auth.accountId）；旧通道用其前 8 位做 providerId。 */
    accountId?: string;
    /** 是否有网页会话登录态（session token）。注意：access token 只够后端统计，浏览器出图必须有 session token。 */
    webToken?: boolean;
}
/** 账号 → 通道 id：优先用账号 UUID 前 8 位（与脚本的历史约定一致）。 */
export declare function accountChannelId(account: AccountLike): string;
/** 通道 providerId 后缀是否指向该账号（与 generate_image.mjs 的匹配规则一致）。 */
export declare function accountChannelMatches(account: AccountLike, suffix: string): boolean;
/**
 * 账号库是 ChatGPT 网页通道的唯一真源：
 *  - 有网页登录态的账号 → 确保有对应 gen 通道（没有就补、名字跟账号走）；
 *  - 所有 chatgpt-web@ 通道行清掉 apiKey（登录态只在账号库里存一份，避免 providers.json 重复泄漏 token）。
 *
 * 不做删除：删账号的清理由调用方传 removedAccount 显式处理，避免误删手写/孤儿行。
 */
export declare function planAccountChannels(providers: readonly ProviderItem[], accounts: readonly AccountLike[]): {
    rows: ProviderItem[];
    added: string[];
    updated: string[];
    clearedCredentials: string[];
};
export type EnvAction = 'set' | 'delete' | 'keep';
export interface EnvRow {
    key: string;
    action: EnvAction;
    value?: string;
}
export interface SyncPlan {
    vision: {
        rows: EnvRow[];
        chain: string[];
    };
    gen: {
        rows: EnvRow[];
        chain: string[];
    };
    warnings: string[];
}
/**
 * 由通道列表推导两份 skill .env 的写入计划。
 *
 * `previous` 用来区分「用户删掉了这个供应商」与「面板从来没管过它」：
 *  - 从没管过 → 不动 .env（保护手写配置）；
 *  - 面板里管理过、现在没了 / 全部停用 → 删除对应 env 行。
 *
 * 纯函数：宿主直接执行；客户端拿同一份计划做保存前预览。
 */
export declare function planSync(providers: readonly ProviderItem[], previous?: readonly ProviderItem[]): SyncPlan;
/** 保存前校验：只有「写进 .env 后必然跑不通」的硬错误才拦保存。 */
export declare function validateProviders(providers: readonly ProviderItem[]): string[];
/** EnvRow[] → writeEnv 需要的 updates 表（keep 不出现，set/delete 才带键）。 */
export declare function envUpdates(rows: readonly EnvRow[]): Record<string, string>;
