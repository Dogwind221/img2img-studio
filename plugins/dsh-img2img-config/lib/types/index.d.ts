/**
 * dsh-img2img-config host entry — the img2img-studio skill's plugin.
 *
 * One package, two browser surfaces, one host half:
 *  - `./client` renders the composer image editor (dock entry) *and* the
 *    Settings → 「识图与生图」 panel. Neither needs a host service, so the
 *    editor contributes nothing here.
 *  - This entry owns what the panel talks to: the provider store and the HTTP
 *    routes behind `/dsh-img2img-config/*` — multi-provider management with
 *    three priority levels (main / backup / fallback), manual switches,
 *    drag ordering, and auto-disable on arrears — plus the ChatGPT web-account
 *    and Codex usage probes.
 *
 * The panel configures BOTH halves of the toolchain: 识图 (dsh-vision-skill)
 * and 生图 (this skill). Saving writes each provider back to the matching
 * skill's `scripts/.env`, so the skill's own scripts pick the settings up with
 * no extra step.
 *
 * 配置持久化: ~/.dsh/dsh-img2img-config/providers.json（含 ChatGPT 账号库），
 * 保存时同步两个 skill 的 .env。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ProviderItem, type ProviderStatus } from './catalog.js';
export declare const name = "dsh-img2img-config";
export type { ProviderItem, ProviderKind, ProviderStatus } from './catalog.js';
export { HOST_PROTOCOL_VERSION } from './catalog.js';
/**
 * 把 providers 同步到 .env（vision + gen）。
 *
 * 真正的「哪些键写入/删除/保持」由 catalog.ts 的 planSync() 决定
 * （同一份计划也用于面板的保存前预览）：
 *  - 面板管理过、现在删掉或全部停用的供应商 → 删除其 env 行；
 *  - 面板从来没管过的供应商 → 保持原值，避免抹掉手写配置。
 */
/** 导出给离线回归测试（scripts/verify-catalog.mjs）使用。 */
export declare function syncEnv(list: ProviderItem[], previous?: ProviderItem[]): void;
/** 探测结果（导出给离线回归测试 scripts/verify-http.mjs）。 */
export interface ProbeResult {
    status: ProviderStatus;
    detail: string;
}
/**
 * 从一次 HTTP 探测响应判断通道状态。
 *
 * 欠费只在三种证据下判定：HTTP 402、结构化错误码（`insufficient_quota` 等）、
 * 或 429 且正文明确说额度/欠费。超时、5xx、普通 429 限流一律是 `error`——
 * 网络抖动不能把主通道自动关停。
 * @param status - HTTP 状态码。
 * @param bodyText - 响应正文原始文本（可能是 JSON、纯文本或空）。
 * @returns 探测状态与中文说明（诊断文本，不参与面板 i18n）。
 */
export declare function classifyHttpProbe(status: number, bodyText: string): ProbeResult;
interface WebServerService {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/** ChatGPT 套餐档位：免费 / Plus / 5x(Pro) / 20x(Business)。 */
export type ChatGptPlan = 'free' | 'plus' | '5x' | '20x';
/**
 * 套餐预设：默认 24h 出图额度上限。数字是经验值，面板可逐账号覆盖
 * （`limit: null` 表示跟随套餐预设），以用户账号的真实额度为准。
 */
export declare const PLAN_PRESETS: Record<ChatGptPlan, {
    label: string;
    limit: number;
    note: string;
}>;
/** ChatGPT 网页账号的探测凭据：session cookie、已换取的 access token，或 Codex 客户端登录态。 */
export interface ChatGptAuth {
    /** `__Secure-next-auth.session-token` 的值（DevTools → Application → Cookies）。 */
    sessionToken?: string;
    /** 由 session 换取的 Bearer token（约 1 小时有效，自动续期）。 */
    accessToken?: string;
    accessTokenExpires?: number;
    accountId?: string;
    planType?: string;
    /** true = 每次探测实时读取 `~/.codex/auth.json`（Codex 桌面/CLI 的登录态）。 */
    codexAuth?: boolean;
    /** Codex 账号的邮箱（仅展示）。 */
    email?: string;
}
/** Codex 用量（/backend-api/codex/usage）。 */
export interface CodexUsage {
    planType?: string;
    email?: string;
    primary?: {
        usedPercent: number;
        windowSeconds: number;
        resetAt: number;
    };
    secondary?: {
        usedPercent: number;
        windowSeconds: number;
        resetAt: number;
    };
    credits?: string;
}
/** 一次自动探测的结果。 */
export interface ChatGptAutoState {
    lastProbeAt?: number;
    lastError?: string;
    /** 窗口内检测到的生成时刻（毫秒），倒序无关，服务端按窗口过滤。 */
    generatedAt?: number[];
    /** 最近一次探测扫过的会话数。 */
    scanned?: number;
    /** 探测诊断（会话/节点/图片计数与样本）。 */
    debug?: string[];
    /** Codex 客户端账号的实时用量。 */
    codexUsage?: CodexUsage;
}
export interface ChatGptAccount {
    id: string;
    label: string;
    plan: ChatGptPlan;
    /** 覆盖该账号的窗口额度上限；null = 跟随套餐预设。 */
    limit: number | null;
    /** 滚动窗口长度（小时）。 */
    windowHours: number;
    /** 已登记的生成时刻（毫秒）。 */
    timestamps: number[];
    /** 档位来源：auto = 探测写入，manual = 用户手选（探测不再覆盖）。 */
    planSource?: 'auto' | 'manual';
    /** 该账号是否用自动探测代替手动登记。 */
    autoProbe?: boolean;
    auth?: ChatGptAuth;
    auto?: ChatGptAutoState;
}
export declare function registerUsageRoutes(host: {
    webServer: WebServerService;
}): () => void;
export declare function apply(ctx: Context): void;
