#!/usr/bin/env node
/**
 * img2img-studio 统一生图脚本 v2（多 Provider，自动降级，性能+最新模型优先）
 *
 * 用法:
 *   node generate_image.mjs --prompt "..." [--size 1:1] [--quality 2k] [--n 1]
 *   node generate_image.mjs --prompt-file prompt.txt --image ref.png --output-dir out
 *   node generate_image.mjs --promptfiles a.md b.md --image ref.png --output out.png
 *   node generate_image.mjs --batchfile batch.json --jobs 4 --output-dir out
 *   node generate_image.mjs --list-providers
 *   node generate_image.mjs --dry-run --prompt "..."
 *
 * 参数:
 *   --prompt <text>            提示词（长 Prompt 建议 --prompt-file）
 *   --prompt-file <path>       从文件读取提示词
 *   --promptfiles <files...>   从多个文件读取并拼接提示词
 *   --image <path|url>         参考图（图生图），可重复传入多张（1-3 张最佳）
 *   --size <WxH|比例>          如 1024x1024 / 1:1 / 2:3 / 3:4 / 16:9 / 1024*1024
 *   --quality <normal|2k>      质量预设（默认 2k，映射到 1K/2K 尺寸）
 *   --n <count>                一次生成张数（默认 1；部分模型固定 1）
 *   --provider <auto|openai|dashscope|zai|seedream|minimax|local|codex-cli>
 *   --model <id>               强制模型（优先级: CLI > 偏好 > env > 内置默认）
 *   --negative-prompt <text>   反向提示词（dashscope/zai 支持）
 *   --dialect <openai-native|ratio-metadata>  OpenAI 兼容网关方言
 *   --batchfile <path>         批量文件（JSON 数组），与 --jobs 配合
 *   --jobs <count>             批量并发数（默认 4，上限 10）
 *   --retries <count>          同供应商重试次数（默认 2，即最多 3 次尝试）
 *   --output-dir <dir>         输出目录（默认 ./generated-images）
 *   --dry-run                  只解析并打印请求，不实际调用
 *   --list-providers           打印供应商配置状态（不泄露密钥）
 *   --json                     JSON 输出
 *
 * 配置（scripts/.env 或环境变量；自动回退读取 dsh-vision-skill 的 .env）:
 *   openai     IMG_BASE_URL + IMG_MODEL + IMG_API_KEY（或 OPENAI_* 别名）
 *   dashscope  DASHSCOPE_API_KEY 或 VISION_API_KEY（默认链: t2i qwen-image-3.0-pro→...→wanx2.1-t2i-turbo；i2i qwen-image-3.0-pro→wan2.7-image-pro）
 *   zai        ZAI_API_KEY 或 BIGMODEL_API_KEY（glm-image，文本渲染强，不支持参考图）
 *   seedream   ARK_API_KEY（doubao-seedream，火山方舟，OpenAI 兼容，4.0+ 支持参考图）
 *   minimax    MINIMAX_API_KEY（image-01，人物一致性 subject_reference）
 *   local      IMG_HTTP_URL（本地 chatgpt-web 类生图服务）
 *   codex-cli  需要 codex CLI 已登录（用 Codex/ChatGPT 订阅出图，无 API key）
 *
 * 模型选择策略：性能优先 + 发布时间最近优先（详见 SKILL.md「模型策略」）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "2.0.0";

/* ---------- .env 加载 ---------- */
function loadDotEnv(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {}
}
loadDotEnv(path.resolve(__dirname, ".env"));
loadDotEnv(path.resolve(__dirname, "..", ".env"));
// 回退读取 dsh-vision-skill 的 .env（复用识图 key 做图生图）：优先相邻目录，其次 ~/.agents/skills
loadDotEnv(path.resolve(__dirname, "..", "..", "dsh-vision-skill", "scripts", ".env"));
loadDotEnv(path.resolve(os.homedir(), ".agents", "skills", "dsh-vision-skill", "scripts", ".env"));
if (ENV.DSH_SKILLS_DIR) loadDotEnv(path.resolve(ENV.DSH_SKILLS_DIR, "dsh-vision-skill", "scripts", ".env"));

const ENV = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- CLI ---------- */
function parseArgs() {
  const argv = process.argv.slice(2);
  const a = { prompt: "", promptFiles: [], images: [], size: "", quality: "2k", n: 1, provider: "auto", model: "", negativePrompt: "", dialect: "", batchfile: "", jobs: 4, retries: 2, outputDir: "", dryRun: false, listProviders: false, json: false };
  const next = (i) => (i + 1 < argv.length ? argv[++i] : "");
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    switch (v) {
      case "--prompt": case "-p": a.prompt = next(i); break;
      case "--prompt-file": a.promptFiles.push(next(i)); break;
      case "--promptfiles": { const f = next(i); if (f) a.promptFiles.push(f); break; }
      case "--image": case "--ref": { const f = next(i); if (f) a.images.push(f); break; }
      case "--size": a.size = next(i); break;
      case "--quality": a.quality = (next(i) || "2k").toLowerCase(); break;
      case "--n": case "--count": a.n = parseInt(next(i), 10) || 1; break;
      case "--provider": a.provider = next(i).toLowerCase(); break;
      case "--model": case "-m": a.model = next(i); break;
      case "--negative-prompt": a.negativePrompt = next(i); break;
      case "--dialect": a.dialect = next(i).toLowerCase(); break;
      case "--batchfile": a.batchfile = next(i); break;
      case "--jobs": a.jobs = Math.min(10, parseInt(next(i), 10) || 4); break;
      case "--retries": a.retries = parseInt(next(i), 10) || 0; break;
      case "--output-dir": case "--output": a.outputDir = next(i); break;
      case "--dry-run": a.dryRun = true; break;
      case "--list-providers": a.listProviders = true; break;
      case "--json": a.json = true; break;
      case "--version": console.log(VERSION); process.exit(0);
      case "--help": case "-h":
        console.log(fs.readFileSync(__filename, "utf8").split("用法:")[1]?.split("*/")[0] || "see header");
        process.exit(0);
      default:
        if (!v.startsWith("--") && !a.prompt) a.prompt = v;
    }
  }
  return a;
}

/* ---------- 尺寸/质量 ---------- */
// 通用比例 → 尺寸（normal=1K 档, 2k=2K 档），qwen-image 推荐分辨率
const RATIO_SIZE = {
  "1:1":  ["1024x1024", "2048x2048"],
  "4:3":  ["1152x864",  "2368x1728"],
  "3:4":  ["864x1152",  "1728x2368"],
  "16:9": ["1344x768",  "2688x1536"],
  "9:16": ["768x1344",  "1536x2688"],
  "3:2":  ["1280x853",  "2304x1536"],
  "2:3":  ["853x1280",  "1536x2304"],
  "21:9": ["1344x576",  "2688x1152"],
  "4:5":  ["1024x1280", "1638x2048"],
};

function normSize(size, quality = "2k") {
  let s = (size || "").trim().toLowerCase().replace(/\s+/g, "");
  const qi = quality === "normal" ? 0 : 1;
  if (!s) return RATIO_SIZE["1:1"][qi];
  if (RATIO_SIZE[s]) return RATIO_SIZE[s][qi];
  // 纯比例如 2.35:1
  const m = s.match(/^(\d+(?:\.\d+)?)[:：x](\d+(?:\.\d+)?)$/);
  if (m) {
    const [w, h] = [parseFloat(m[1]), parseFloat(m[2])];
    const short = qi === 0 ? 1024 : 2048;
    const long = Math.round((short * Math.max(w, h)) / Math.min(w, h));
    return w >= h ? `${long}x${short}` : `${short}x${long}`;
  }
  return s.replace(/\*/g, "x").replace(/[xX]/g, "x"); // 显式 WxH / W*H
}

function dataURLFromFile(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`参考图不存在: ${abs}`);
  const ext = path.extname(abs).toLowerCase().replace(".", "");
  const mime = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", gif: "gif", bmp: "bmp" }[ext] || "jpeg";
  return `data:image/${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
}

// i2i 尺寸上限（实测）：qwen-image-3.0 总像素 ≤ 6553600，wan2.7 ≤ 4194304；取严格值保证双模型兼容
function clampForI2i(sizePx) {
  const [w, h] = sizePx.split("x").map(Number);
  if (!w || !h) return sizePx;
  const MAX = 4194304;
  if (w * h <= MAX) return sizePx;
  const scale = Math.sqrt(MAX / (w * h));
  const nw = Math.max(512, Math.floor((w * scale) / 16) * 16);
  const nh = Math.max(512, Math.floor((h * scale) / 16) * 16);
  return `${nw}x${nh}`;
}

async function requestJson(url, opts = {}, timeoutMs = 300000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text)?.message || JSON.parse(text)?.error?.message || text; } catch {}
      throw new Error(`HTTP ${res.status} ${String(url).split("/api/")[1] || String(url).split("/v1/")[1] || url}: ${String(msg).slice(0, 300)}`);
    }
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

/* ---------- 供应商探测 ---------- */
const masked = (k) => (k ? k.slice(0, 6) + "…" + k.slice(-4) : "");

function detectProviders() {
  const list = [];
  const oBase = ENV.IMG_BASE_URL || ENV.OPENAI_BASE_URL || ENV.OPENAI_API_BASE || "";
  const oKey = ENV.IMG_API_KEY || ENV.OPENAI_API_KEY || "";
  const oModel = ENV.IMG_MODEL || ENV.OPENAI_IMAGE_MODEL || ENV.OPENAI_MODEL || "";
  list.push({
    id: "openai", name: "OpenAI 兼容 API", configured: !!(oBase && oKey), base: oBase,
    model: oModel || "gpt-image-2（默认）", key: oKey, keyMasked: masked(oKey),
    detail: oBase ? `${oBase}` : "缺少 IMG_BASE_URL 或 IMG_API_KEY",
  });

  const dKey = ENV.DASHSCOPE_API_KEY || ENV.VISION_API_KEY || "";
  list.push({
    id: "dashscope", name: "DashScope 通义千问/万相", configured: !!dKey,
    base: "https://dashscope.aliyuncs.com",
    model: ENV.IMG_MODEL || "qwen-image-3.0-pro（默认链，性能+最新优先）",
    key: dKey, keyMasked: masked(dKey),
    detail: dKey ? "已探测到 key（DASHSCOPE_API_KEY 或 VISION_API_KEY）" : "缺少 DASHSCOPE_API_KEY / VISION_API_KEY",
  });

  const zKey = ENV.ZAI_API_KEY || ENV.BIGMODEL_API_KEY || "";
  list.push({
    id: "zai", name: "Z.AI GLM-Image（智谱）", configured: !!zKey,
    base: ENV.ZAI_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
    model: ENV.ZAI_IMAGE_MODEL || "glm-image", key: zKey, keyMasked: masked(zKey),
    detail: zKey ? "已探测到 key（ZAI_API_KEY）" : "缺少 ZAI_API_KEY（https://open.bigmodel.cn 申请）",
  });

  const sKey = ENV.ARK_API_KEY || "";
  list.push({
    id: "seedream", name: "Seedream 豆包（火山方舟）", configured: !!sKey,
    base: ENV.SEEDREAM_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
    model: ENV.SEEDREAM_IMAGE_MODEL || "doubao-seedream-5-0-260128",
    key: sKey, keyMasked: masked(sKey),
    detail: sKey ? "已探测到 key（ARK_API_KEY）" : "缺少 ARK_API_KEY（火山方舟控制台申请）",
  });

  const mKey = ENV.MINIMAX_API_KEY || "";
  list.push({
    id: "minimax", name: "MiniMax 海螺", configured: !!mKey,
    base: ENV.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",
    model: ENV.MINIMAX_IMAGE_MODEL || "image-01", key: mKey, keyMasked: masked(mKey),
    detail: mKey ? "已探测到 key（MINIMAX_API_KEY）" : "缺少 MINIMAX_API_KEY",
  });

  const lUrl = ENV.IMG_HTTP_URL || "";
  list.push({
    id: "local", name: "本地生图服务 (chatgpt-web 类)", configured: !!lUrl,
    base: lUrl, model: "-", key: "", keyMasked: "-",
    detail: lUrl ? lUrl : "未设置 IMG_HTTP_URL（如 http://127.0.0.1:4312）",
  });

  const codexCandidates = ["C:\\Users\\ASUS\\.codex\\plugins\\.plugin-appserver\\codex.exe", "C:\\Users\\ASUS\\.codex\\.sandbox-bin\\codex.exe"];
  const codexFound = codexCandidates.some((p) => fs.existsSync(p));
  list.push({
    id: "codex-cli", name: "Codex CLI（ChatGPT/Codex 订阅）", configured: codexFound,
    base: "codex", model: "-", key: "", keyMasked: "-",
    detail: codexFound ? "已检测到 codex CLI；当前会话若无 imagegen 工具/OPENAI_API_KEY 则无法出图（实测：需登录态 + imagegen 权限）" : "需要 codex CLI 已安装并登录（可选）",
  });
  return list;
}

/* ---------- OpenAI 兼容（generations / edits / dialect） ---------- */
async function openaiGenerate({ prompt, refs, size, n, provider, dialect }) {
  const base = (provider.base || "").replace(/\/?$/, "");
  const model = provider.model || ENV.IMG_MODEL || "gpt-image-2";
  if (refs.length) {
    // 图生图：/images/edits（multipart）
    const boundary = "----img2img" + Date.now();
    const parts = [];
    const addField = (name, value) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    addField("model", model);
    addField("prompt", prompt);
    addField("size", size);
    addField("n", String(n));
    for (const f of refs) {
      const abs = path.resolve(f);
      if (!fs.existsSync(abs)) throw new Error(`参考图不存在: ${abs}`);
      const ext = path.extname(abs).slice(1) || "png";
      const mime = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp" }[ext] || "png";
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${path.basename(abs)}"\r\nContent-Type: image/${mime}\r\n\r\n`));
      parts.push(fs.readFileSync(abs));
      parts.push(Buffer.from("\r\n"));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return await requestJson(`${base}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(parts),
    });
  }
  const body = { model, prompt, n };
  if (dialect === "ratio-metadata") {
    // 面向 Gemini 类中转网关：size 传比例 + metadata.resolution/orientation
    const [w, h] = size.split("x").map(Number);
    const ratio = `${w / Math.max(1, h)}:1`;
    body.size = w >= h ? `${ratio}` : `1:${h / Math.max(1, w)}`;
    body.metadata = { resolution: "2K", orientation: w >= h ? "landscape" : "portrait" };
  } else {
    body.size = size;
  }
  return await requestJson(`${base}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ---------- DashScope ---------- */
const DS_BASE = "https://dashscope.aliyuncs.com";
const DS_QWEN_T2I = ["qwen-image-3.0-pro", "qwen-image-3.0", "wan2.7-image-pro"];
const DS_WANX_T2I = ["wan2.1-t2i-plus", "wan2.1-t2i-turbo"];
const DS_I2I = ["qwen-image-3.0-pro", "wan2.7-image-pro"];

async function dashscopeQwenImage({ prompt, refs, size, n, key, model, negativePrompt }) {
  // 同步 multimodal-generation（messages 格式；i2i 用 {image}+{text}）
  const content = [];
  if (refs.length) {
    for (const f of refs) content.push({ image: f.startsWith("http") ? f : dataURLFromFile(f) });
  }
  content.push({ text: prompt });
  const parameters = { size: size.replace(/x/g, "*"), n, watermark: false };
  if (negativePrompt) parameters.negative_prompt = negativePrompt;
  const body = { model, input: { messages: [{ role: "user", content }] }, parameters };
  const r = await requestJson(`${DS_BASE}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 600000);
  return r;
}

async function dashscopeWanxAsync({ prompt, size, n, key, model, negativePrompt }) {
  const parameters = { size: size.replace(/x/g, "*"), n };
  if (negativePrompt) parameters.negative_prompt = negativePrompt;
  const r = await requestJson(`${DS_BASE}/api/v1/services/aigc/text2image/image-synthesis`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
    body: JSON.stringify({ model, input: { prompt }, parameters }),
  }, 60000);
  return await dashscopeTaskPoll(r?.output?.task_id, key);
}

async function dashscopeTaskPoll(taskId, key) {
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const t = await requestJson(`${DS_BASE}/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
    const st = t?.output?.task_status;
    if (st === "SUCCEEDED") return t;
    if (st === "FAILED" || st === "CANCELED") throw new Error(`DashScope 任务失败: ${t.output?.message || st}`);
  }
  throw new Error("DashScope 任务轮询超时");
}

async function dashscopeGenerate({ prompt, refs, size, n, key, model, negativePrompt }) {
  if (model) {
    if (model.startsWith("wanx") || model.startsWith("wan2.1") || model.startsWith("wan2.2")) {
      const out = await dashscopeWanxAsync({ prompt, size, n, key, model, negativePrompt });
      out._model = model;
      return out;
    }
    const out = await dashscopeQwenImage({ prompt, refs, size, n, key, model, negativePrompt });
    out._model = model;
    return out;
  }
  const chain = refs.length ? DS_I2I : [...DS_QWEN_T2I, ...DS_WANX_T2I];
  let lastErr = null;
  for (const m of chain) {
    try {
      let out;
      if (m.startsWith("wanx") || m.startsWith("wan2.1") || m.startsWith("wan2.2")) {
        out = await dashscopeWanxAsync({ prompt, size, n, key, model: m, negativePrompt });
      } else {
        out = await dashscopeQwenImage({ prompt, refs, size, n, key, model: m, negativePrompt });
      }
      out._model = m;
      return out;
    } catch (e) {
      lastErr = e;
      console.error(`[generate_image] dashscope 模型 ${m} 失败: ${String(e.message).slice(0, 160)}`);
      if (refs.length && m === chain[chain.length - 1]) {
        throw new Error(`${e.message} [指引] i2i 全链失败时，回退为「L1 识图描述 + 文生图」（SKILL.md 的 Layer 1 已保证 prompt 自带主体描述）`);
      }
    }
  }
  throw lastErr || new Error("DashScope 所有模型均失败");
}

/* ---------- Z.AI（OpenAI 兼容 images/generations） ---------- */
async function zaiGenerate({ prompt, refs, size, n, provider }) {
  if (refs.length) throw new Error("Z.AI glm-image 不支持参考图；请换 dashscope/openai/seedream，或使用「识图描述 + 文生图」");
  const base = (provider.base || "https://open.bigmodel.cn/api/paas/v4").replace(/\/?$/, "");
  const r = await requestJson(`${base}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: provider.model || "glm-image", prompt, size, quality: "hd", n: Math.min(n, 1) }),
  }, 300000);
  r._model = provider.model || "glm-image";
  return r;
}

/* ---------- Seedream 豆包（OpenAI 兼容） ---------- */
async function seedreamGenerate({ prompt, refs, size, n, provider }) {
  const base = (provider.base || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/?$/, "");
  const model = provider.model || "doubao-seedream-5-0-260128";
  let r;
  if (refs.length) {
    const boundary = "----img2img" + Date.now();
    const parts = [];
    const addField = (name, value) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    addField("model", model);
    addField("prompt", prompt);
    addField("size", size);
    addField("n", String(Math.min(n, 1)));
    for (const f of refs) {
      const abs = path.resolve(f);
      const ext = path.extname(abs).slice(1) || "png";
      const mime = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp" }[ext] || "png";
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${path.basename(abs)}"\r\nContent-Type: image/${mime}\r\n\r\n`));
      parts.push(fs.readFileSync(abs));
      parts.push(Buffer.from("\r\n"));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    r = await requestJson(`${base}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(parts),
    }, 300000);
  } else {
    r = await requestJson(`${base}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, size, n: Math.min(n, 1) }),
    }, 300000);
  }
  r._model = model;
  return r;
}

/* ---------- MiniMax（OpenAI 兼容；人物一致性 subject_reference） ---------- */
async function minimaxGenerate({ prompt, refs, size, n, provider }) {
  const base = (provider.base || "https://api.minimaxi.com/v1").replace(/\/?$/, "");
  const model = provider.model || "image-01";
  const body = { model, prompt, n: Math.min(n, 1) };
  const [w, h] = size.split("x").map(Number);
  body.aspect_ratio = `${w}:${h}`;
  if (refs.length) body.subject_reference = refs.map((f) => (f.startsWith("http") ? f : dataURLFromFile(f)));
  const r = await requestJson(`${base}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 300000);
  r._model = model;
  return r;
}

/* ---------- local 本地生图服务 ---------- */
async function localGenerate({ prompt, refs, size, n, base }) {
  const b = base.replace(/\/?$/, "");
  const body = { prompt, images: refs.map((f) => path.resolve(f)), timeout_sec: 300 };
  if (size) body.size = size;
  if (n > 1) body.n = n;
  return await requestJson(`${b}/v1/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 300000);
}

/* ---------- codex-cli（探测实际路径 + 调用；需要 codex 登录态与 imagegen 工具） ---------- */
async function codexCliBinary() {
  const candidates = [
    process.env.CODEX_BIN || "",
    "codex",
    "C:\\Users\\ASUS\\.codex\\plugins\\.plugin-appserver\\codex.exe",
    "C:\\Users\\ASUS\\.codex\\.sandbox-bin\\codex.exe",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync(c, ["--version"], { stdio: "ignore", timeout: 8000 });
      return c;
    } catch {}
  }
  return null;
}

async function codexCliGenerate({ prompt, refs, size, n }) {
  const bin = await codexCliBinary();
  if (!bin) throw new Error("未找到 codex CLI（codex-cli provider 需要本机安装 codex 并登录）");
  const { execFile } = await import("node:child_process");
  const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never"];
  for (const f of refs) args.push("--image", path.resolve(f));
  const stdin = `Use imagegen to create an image with this request:\n${prompt}\n\nSize: ${size}\nRequirements:\n- Generate the image directly\n- Do not provide explanation\n- Return only the saved image file path`;
  const out = await new Promise((resolve, reject) => {
    const child = execFile(bin, [...args, "-"], { timeout: 90000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => (err ? reject(new Error(err.message)) : resolve(String(stdout))));
    child.stdin.write(stdin);
    child.stdin.end();
  });
  const m = out.match(/([A-Za-z]:\\[^\s]+\.(?:png|jpg|jpeg|webp)|~\/[^\s]+\.(?:png|jpg|jpeg|webp)|\/[^\s]+\.(?:png|jpg|jpeg|webp))/);
  if (!m) throw new Error(`codex exec 未返回图片路径: ${out.slice(0, 300)}`);
  return { _codexFile: m[1], data: [] };
}

/* ---------- 保存结果 ---------- */
async function saveImages(resp, outDir, prefix) {
  fs.mkdirSync(outDir, { recursive: true });
  const items = [];
  const push = async (buf, i) => {
    const file = path.join(outDir, `${prefix}-${String(i).padStart(2, "0")}.png`);
    fs.writeFileSync(file, buf);
    items.push(file);
  };
  // 兼容多种响应结构：OpenAI data[] / DashScope qwen choices[].message.content[].image / DashScope wanx output.results[] / local images[]
  const found = [];
  if (Array.isArray(resp?.data)) found.push(...resp.data);
  if (Array.isArray(resp?.images)) found.push(...resp.images);
  if (Array.isArray(resp?.output?.results)) found.push(...resp.output.results);
  if (Array.isArray(resp?.output?.choices)) {
    for (const c of resp.output.choices) {
      if (Array.isArray(c?.message?.content)) found.push(...c.message.content);
    }
  }
  const data = found;
  let i = 0;
  for (const d of data) {
    i++;
    const url = d?.b64_json ? null : (d?.url || d?.image || d?.image_url || (typeof d === "string" ? d : ""));
    if (d?.b64_json) { await push(Buffer.from(d.b64_json, "base64"), i); continue; }
    if (!url) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载结果图失败: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = (res.headers.get("content-type") || "").includes("jpeg") ? "jpg" : "png";
    const file = path.join(outDir, `${prefix}-${String(i).padStart(2, "0")}.${ext}`);
    fs.writeFileSync(file, buf);
    items.push(file);
  }
  if (resp?._codexFile) items.push(resp._codexFile);
  if (!items.length && data.length) throw new Error("无法从响应中解析图片数据");
  return items;
}

/* ---------- 单次生成（含重试） ---------- */
async function generateOnce(task, providers, retries) {
  const { prompt, size, quality, n, providerId, model, dialect } = task;
  const images = task.images || (task.image ? [task.image] : []) || task.refs || [];
  let sizePx = normSize(size, quality);
  if (images.length) sizePx = clampForI2i(sizePx);
  const configured = providers.filter((p) => p.configured);
  const wanted = providerId && providerId !== "auto" ? providers.find((p) => p.id === providerId) : null;
  const chain = wanted ? [wanted] : configured;
  if (wanted && !wanted.configured) throw new Error(`供应商 ${providerId} 未配置`);
  const errors = [];
  for (const p of chain) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        let resp;
        const args = { prompt, refs: images, size: sizePx, n, dialect };
        if (p.id === "openai") resp = await openaiGenerate({ ...args, provider: p });
        else if (p.id === "dashscope") resp = await dashscopeGenerate({ ...args, key: p.key, model: model || "", negativePrompt: task.negativePrompt });
        else if (p.id === "zai") resp = await zaiGenerate({ ...args, provider: p });
        else if (p.id === "seedream") resp = await seedreamGenerate({ ...args, provider: p });
        else if (p.id === "minimax") resp = await minimaxGenerate({ ...args, provider: p });
        else if (p.id === "local") resp = await localGenerate({ ...args, base: p.base });
        else if (p.id === "codex-cli") resp = await codexCliGenerate({ ...args });
        else throw new Error(`未知供应商 ${p.id}`);
        return { ok: true, provider: p.id, model: resp?._model || p.model, size: sizePx, files: await saveImages(resp, task.outputDir || path.resolve("generated-images"), `img-${Date.now()}-${Math.floor(Math.random() * 1000)}`) };
      } catch (e) {
        errors.push({ provider: p.id, attempt: attempt + 1, error: e.message });
        if (attempt < retries) console.error(`[generate_image] ${p.id} 第 ${attempt + 1} 次失败，重试: ${e.message.split("\n")[0]}`);
      }
    }
  }
  return { ok: false, errors };
}

/* ---------- main ---------- */
async function main() {
  const a = parseArgs();
  const providers = detectProviders();

  if (a.listProviders) {
    console.log(JSON.stringify({ version: VERSION, providers: providers.map((p) => ({ id: p.id, name: p.name, configured: p.configured, base: p.base, model: p.model, key: p.keyMasked, detail: p.detail })) }, null, 2));
    process.exit(0);
  }

  // 批量模式
  if (a.batchfile) {
    const bf = path.resolve(a.batchfile);
    if (!fs.existsSync(bf)) { console.error(`批量文件不存在: ${bf}`); process.exit(1); }
    const tasks = JSON.parse(fs.readFileSync(bf, "utf8").replace(/^\uFEFF/, ""));
    if (!Array.isArray(tasks) || !tasks.length) { console.error("批量文件需为 JSON 数组"); process.exit(1); }
    if (a.dryRun) {
      console.log(JSON.stringify({ version: VERSION, dryRun: true, jobs: Math.min(a.jobs || 4, tasks.length), plan: tasks.map((t) => ({ prompt: (t.prompt || "").slice(0, 80), image: t.image || t.images || t.refs || [], size: normSize(t.size, t.quality || a.quality), quality: t.quality || a.quality, provider: t.providerId || a.provider || "auto" })) }, null, 2));
      process.exit(0);
    }
    const jobs = Math.min(a.jobs || 4, tasks.length);
    const queue = [...tasks];
    const results = [];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        results.push(await generateOnce({ ...t, quality: t.quality || a.quality, outputDir: t.outputDir || a.outputDir }, providers, a.retries));
      }
    };
    const workers = Array.from({ length: jobs }, () => worker());
    await Promise.all(workers);
    const ok = results.filter((r) => r.ok);
    const fail = results.filter((r) => !r.ok);
    const out = { ok: ok.length, failed: fail.length, jobs, results };
    console.log(a.json ? JSON.stringify(out, null, 2) : JSON.stringify(out, null, 2));
    process.exit(fail.length ? 1 : 0);
  }

  // 单图模式
  let prompt = a.prompt;
  if (a.promptFiles.length) {
    const parts = [];
    for (const f of a.promptFiles) {
      const p = path.resolve(f);
      if (!fs.existsSync(p)) { console.error(`提示词文件不存在: ${p}`); process.exit(1); }
      parts.push(fs.readFileSync(p, "utf8").trim());
    }
    prompt = parts.join("\n\n");
  }
  if (!prompt) {
    console.error("用法: node generate_image.mjs --prompt \"...\" [--image ref.png] [--size 1:1] [--quality 2k]");
    console.error("      node generate_image.mjs --batchfile batch.json --jobs 4");
    console.error("      node generate_image.mjs --list-providers");
    process.exit(1);
  }

  if (a.dryRun) {
    const sizePx = normSize(a.size, a.quality);
    const configured = providers.filter((p) => p.configured);
    console.log(JSON.stringify({
      version: VERSION,
      prompt: prompt.slice(0, 200) + (prompt.length > 200 ? "…" : ""),
      refs: a.images, size: sizePx, quality: a.quality, n: a.n,
      providerChain: (a.provider && a.provider !== "auto" ? [a.provider] : configured.map((p) => p.id)),
      model: a.model || "(默认链)", outputDir: a.outputDir || "./generated-images",
    }, null, 2));
    process.exit(0);
  }

  const result = await generateOnce({
    prompt, images: a.images, size: a.size, quality: a.quality, n: a.n,
    providerId: a.provider, model: a.model, dialect: a.dialect, negativePrompt: a.negativePrompt,
    outputDir: a.outputDir,
  }, providers, a.retries);

  if (result.ok) {
    console.log(JSON.stringify({ ok: true, provider: result.provider, model: result.model, size: result.size, files: result.files }, null, 2));
    process.exit(0);
  }
  console.error("所有供应商均失败:");
  for (const e of result.errors) console.error(`  - ${e.provider} (第${e.attempt}次): ${e.error}`);
  if (a.json) console.log(JSON.stringify({ ok: false, errors: result.errors }, null, 2));
  await sleep(300);
  process.exit(1);
}

main().catch((e) => { console.error("生图失败:", e.message); process.exit(1); });
