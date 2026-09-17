#!/usr/bin/env node
/**
 * img2img-studio · 图像编辑（GUI 编辑器交回的编辑请求 → 供应商出图）
 *
 * 处理 dsh-img2img-config 面板交回的「编辑后的底图 + 涂抹掩码 + 标记说明」，
 * 也支持命令行直接做单步编辑。掩码语义在这里统一转换：
 *   面板/涂抹掩码 = 白(255) = 要处理/重绘的区域，黑(0) = 保留
 *   wanx2.1-imageedit  : 白 = 重绘（同尺寸 + 二值化后直接可用）
 *   OpenAI images/edits: alpha=0（透明）= 重绘（白→透明，脚本自动转）
 *
 * 用法:
 *   node scripts/edit_image.mjs info --image in.png
 *   node scripts/edit_image.mjs resize --image in.png --size 1024x1024 --mode cover --out out.png
 *   node scripts/edit_image.mjs bg-remove --image in.png --out cutout.png [--provider auto|cloud|local] [--tolerance 36]
 *   node scripts/edit_image.mjs erase --image in.png --mask mask.png --prompt "抹掉并补背景" --out out.png [--provider auto|dashscope|openai|i2i]
 *   node scripts/edit_image.mjs markers --image in.png --markers markers.json --out marked.png
 *   node scripts/edit_image.mjs mask-from-markers --markers markers.json --like in.png --out mask.png [--radius 0.03]
 *   node scripts/edit_image.mjs local-edit --image in.png --markers markers.json --prompt "..." --out out.png [--radius 0.12] [--padding 0.6] [--highlight overlay|none]
 *   node scripts/edit_image.mjs manifest --manifest edit.json --out-dir out [--generate] [--size 1:1] [--prompt "整体风格..."]
 *
 * 输入输出都是 PNG（面板导出即 PNG）；JPEG 只读尺寸，需要先转 PNG。
 * 本脚本不派生任何解释器进程（DSH 文件沙箱禁止管道 stdio 与从 Node 派生 pwsh），
 * 本地像素操作全部在进程内完成（scripts/edit/）；仅有的子进程是复用同目录的 Node 脚本
 * （erase 的 i2i 兜底、local-edit、manifest --generate 调 generate_image.mjs），
 * stdout 重定向到文件（沙箱禁止管道 stdio）。云端通道：
 *   - 局部重绘/擦除：DashScope wanx2.1-imageedit（异步，0.14 元/张，免费额度 500 张）
 *   - 抠图（透明 PNG）：OpenAI 兼容 images/edits（background=transparent）
 *   - 兜底：本地纯色背景抠图 / 把涂抹区域涂红后走整体 i2i
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { probeSize } from "./edit/png.mjs";
import {
  binarizeRaster, compositePatch, compositeWithMask, cropRect, cutoutRaster, drawMarkerPins,
  maskFromMarkers, maskEllipseRaster, maskRectRaster, maskToAlphaRaster, overlayMaskRaster, readRaster, resizeRaster, writePng,
} from "./edit/raster.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = "1.0.0";

/* ---------- .env 加载（与 generate_image.mjs 同源） ---------- */
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
loadDotEnv(path.resolve(__dirname, "..", "..", "dsh-vision-skill", "scripts", ".env"));
loadDotEnv(path.resolve(os.homedir(), ".agents", "skills", "dsh-vision-skill", "scripts", ".env"));
if (process.env.DSH_SKILLS_DIR) {
  loadDotEnv(path.resolve(process.env.DSH_SKILLS_DIR, "dsh-vision-skill", "scripts", ".env"));
}
const ENV = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- CLI ---------- */
function parseArgs(argv) {
  const a = {
    op: "", image: "", mask: "", markers: "", manifest: "", out: "", outDir: "", imageDir: "",
    size: "", mode: "cover", provider: "auto", prompt: "", tolerance: 36, radius: 0.03, padding: 0.6, highlight: "overlay",
    crop: "", maskRect: "", maskEllipse: "", feather: 2, genProvider: "",
    threshold: 128, like: "", generate: false, json: false, help: false, quality: "normal",
  };
  const next = (i) => (i + 1 < argv.length ? argv[++i] : "");
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    switch (v) {
      case "--image": case "-i": a.image = next(i); break;
      case "--mask": a.mask = next(i); break;
      case "--markers": a.markers = next(i); break;
      case "--manifest": a.manifest = next(i); break;
      case "--out": case "-o": a.out = next(i); break;
      case "--out-dir": case "--output-dir": a.outDir = next(i); break;
      case "--image-dir": a.imageDir = next(i); break;
      case "--size": a.size = next(i); break;
      case "--mode": a.mode = (next(i) || "cover").toLowerCase(); break;
      case "--provider": a.provider = (next(i) || "auto").toLowerCase(); break;
      case "--prompt": case "-p": a.prompt = next(i); break;
      case "--tolerance": a.tolerance = parseInt(next(i), 10) || 36; break;
      case "--radius": a.radius = parseFloat(next(i)) || 0.03; break;
      case "--padding": a.padding = parseFloat(next(i)) || 0.6; break;
      case "--highlight": a.highlight = (next(i) || "overlay").toLowerCase(); break;
      case "--crop": a.crop = next(i); break;
      case "--mask-rect": a.maskRect = next(i); break;
      case "--mask-ellipse": a.maskEllipse = next(i); break;
      case "--feather": a.feather = parseInt(next(i), 10) || 2; break;
      case "--gen-provider": a.genProvider = next(i); break;
      case "--threshold": a.threshold = parseInt(next(i), 10) || 128; break;
      case "--like": a.like = next(i); break;
      case "--quality": a.quality = (next(i) || "normal").toLowerCase(); break;
      case "--generate": a.generate = true; break;
      case "--json": a.json = true; break;
      case "--version": console.log(VERSION); process.exit(0);
      case "--help": case "-h": a.help = true; break;
      default:
        if (!v.startsWith("-") && !a.op) a.op = v;
    }
  }
  return a;
}

/** --json 只输出机器可读结果；人类可读行全部静默。 */
let JSON_MODE = false;
/** 业务失败：抛到 main 的兜底里统一打印，绝不在异步收尾前 process.exit（Windows 上会触发 libuv 断言）。 */
class CliError extends Error {}
const fail = (message) => { throw new CliError(message); };

const RATIO_SIZE = {
  "1:1": ["1024x1024", "2048x2048"], "4:3": ["1152x864", "2368x1728"], "3:4": ["864x1152", "1728x2368"],
  "16:9": ["1344x768", "2688x1536"], "9:16": ["768x1344", "1536x2688"], "3:2": ["1280x853", "2304x1536"],
  "2:3": ["853x1280", "1536x2304"], "4:5": ["1024x1280", "1638x2048"],
};

function normSize(size, quality = "normal") {
  const s = String(size || "").trim().toLowerCase().replace(/\s+/g, "");
  const qi = quality === "2k" ? 1 : 0;
  if (RATIO_SIZE[s]) return RATIO_SIZE[s][qi];
  const px = s.match(/^(\d{2,5})[x*](\d{2,5})$/);
  if (px) return `${Number(px[1])}x${Number(px[2])}`;
  const m = s.match(/^(\d+(?:\.\d+)?)[:：](\d+(?:\.\d+)?)$/);
  if (m) {
    const [w, h] = [parseFloat(m[1]), parseFloat(m[2])];
    const short = qi === 0 ? 1024 : 2048;
    const long = Math.round((short * Math.max(w, h)) / Math.min(w, h));
    return w >= h ? `${long}x${short}` : `${short}x${long}`;
  }
  return s;
}

/* ---------- 文件/网络工具 ---------- */
function dataURLFromFile(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) fail(`图片不存在: ${abs}`);
  const ext = path.extname(abs).toLowerCase().replace(".", "");
  const mime = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", gif: "gif", bmp: "bmp" }[ext] || "png";
  return `data:image/${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
}

function imageSize(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) fail(`图片不存在: ${abs}`);
  return probeSize(fs.readFileSync(abs));
}

/** 读 JSON 文件：容忍 PowerShell `Set-Content` 写的 UTF-8 BOM 与 CRLF。 */
function readJsonFile(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) fail(`文件不存在: ${abs}`);
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, "").trim());
}

function parseMarkers(file) {
  const raw = readJsonFile(file);
  const list = Array.isArray(raw) ? raw : (raw?.markers ?? []);
  return list.map((m, index) => ({
    id: Number.isFinite(m?.id) ? m.id : index + 1,
    x: Number(m?.x) || 0,
    y: Number(m?.y) || 0,
    text: typeof m?.text === "string" ? m.text : "",
  }));
}

async function download(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载结果图失败: HTTP ${res.status}`);
  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  return target;
}

async function requestJson(url, opts = {}, timeoutMs = 180000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text)?.message || JSON.parse(text)?.error?.message || text; } catch {}
      throw new Error(`HTTP ${res.status}: ${String(msg).slice(0, 300)}`);
    }
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

function tempPng(raster, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "img2img-edit-"));
  return writePng(path.join(dir, name), raster);
}

/**
 * 调一次 generate_image.mjs（i2i），把第一张产物复制到 targetOut。
 *
 * stdout/stderr 重定向到文件而不是管道：DSH 沙箱禁止管道 stdio（EPERM），
 * 重定向到文件在两种沙箱模式下都能用，还能顺便从 --json 输出里读出真实通道。
 */
function runGenerateImage(prompt, imagePath, targetOut, provider = "") {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "img2img-gen-"));
  const logFile = path.join(scratch, "run.log");
  const fd = fs.openSync(logFile, "w");
  let status = -1;
  try {
    const args = [
      path.join(__dirname, "generate_image.mjs"), "--prompt", prompt, "--output-dir", scratch, "--json",
      ...(imagePath ? ["--image", path.resolve(imagePath)] : []),
      ...(provider ? ["--provider", provider] : []),
    ];
    const res = spawnSync(process.execPath, args, { stdio: ["ignore", fd, fd] });
    status = res.status ?? -1;
  } finally { fs.closeSync(fd); }
  const log = fs.readFileSync(logFile, "utf8");
  if (status !== 0) {
    const tail = log.split(/\r?\n/).filter((line) => line.trim() !== "").slice(-6).join(" | ");
    throw new Error(`generate_image.mjs 退出码 ${status}：${tail.slice(0, 400)}`);
  }
  let parsed = null;
  const start = log.indexOf("{");
  if (start >= 0) { try { parsed = JSON.parse(log.slice(start)); } catch { parsed = null; } }
  const reported = Array.isArray(parsed?.files) ? parsed.files.filter((file) => fs.existsSync(file)) : [];
  const files = reported.length > 0
    ? reported
    : fs.readdirSync(scratch).filter((file) => /\.(png|jpe?g|webp)$/i.test(file)).map((file) => path.join(scratch, file));
  if (files.length === 0) throw new Error("generate_image.mjs 没有产出图片");
  // 图生图返回原图 = 模型没出图（网页通道曾把上传的参考图当结果）
  if (imagePath && fs.readFileSync(files[0]).equals(fs.readFileSync(path.resolve(imagePath)))) {
    throw new Error(`通道 ${parsed?.provider ?? "?"} 返回的图片与输入完全相同（模型没有出图）：请换通道或改写 prompt`);
  }
  if (targetOut) {
    const target = path.resolve(targetOut);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(files[0], target);
  }
  return { files, provider: parsed?.provider ?? "unknown", model: parsed?.model, size: parsed?.size, log: logFile };
}

/* ---------- 供应商凭据 ---------- */
const dashscopeKey = () => ENV.DASHSCOPE_API_KEY || ENV.VISION_API_KEY || "";
const dashscopeBase = () => (ENV.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com").replace(/\/+$/, "");
function openaiCreds() {
  return {
    base: (ENV.IMG_BASE_URL || ENV.OPENAI_BASE_URL || ENV.OPENAI_API_BASE || "").replace(/\/+$/, ""),
    key: ENV.IMG_API_KEY || ENV.OPENAI_API_KEY || "",
    model: ENV.IMG_MODEL || ENV.OPENAI_IMAGE_MODEL || "gpt-image-2",
  };
}

/* ---------- 本地 op ---------- */
function opResize(a) {
  if (!a.image || !a.out) fail("resize 需要 --image 与 --out");
  if (!a.size) fail("resize 需要 --size（如 1024x1024 或 1:1）");
  const [width, height] = normSize(a.size, a.quality).split("x").map(Number);
  const out = writePng(a.out, resizeRaster(readRaster(a.image), width, height, a.mode));
  return { op: "resize", out, width, height, mode: a.mode };
}

function opMarkers(a) {
  if (!a.image || !a.markers || !a.out) fail("markers 需要 --image --markers --out");
  const markers = parseMarkers(a.markers);
  const out = writePng(a.out, drawMarkerPins(readRaster(a.image), markers));
  return { op: "markers", out, count: markers.length };
}

function opMaskFromMarkers(a) {
  if (!a.markers || !a.out) fail("mask-from-markers 需要 --markers 与 --out");
  const markers = parseMarkers(a.markers);
  let width; let height;
  if (a.like) ({ width, height } = imageSize(a.like));
  else if (a.size) [width, height] = normSize(a.size, a.quality).split("x").map(Number);
  else fail("mask-from-markers 需要 --like <图> 或 --size");
  const out = writePng(a.out, maskFromMarkers(width, height, markers, a.radius));
  return { op: "mask-from-markers", out, width, height, count: markers.length };
}

async function opBgRemove(a) {
  if (!a.image || !a.out) fail("bg-remove 需要 --image 与 --out");
  const creds = openaiCreds();
  const canCloud = creds.base !== "" && creds.key !== "";
  const local = () => {
    const out = writePng(a.out, cutoutRaster(readRaster(a.image), a.tolerance));
    return { op: "bg-remove", provider: "local", out, note: "本地纯色背景抠图（复杂背景请用云端抠图）" };
  };
  if (a.provider === "local" || (a.provider === "auto" && !canCloud)) {
    if (a.provider === "auto") {
      const result = local();
      result.note = "未配置 OpenAI 兼容通道（IMG_BASE_URL/IMG_API_KEY），已用本地纯色背景抠图";
      return result;
    }
    return local();
  }
  try {
    const form = new FormData();
    form.append("model", creds.model);
    form.append("prompt", "Remove the background completely and keep only the subject with clean edges. Transparent background, no shadow, no extra objects.");
    form.append("background", "transparent");
    form.append("output_format", "png");
    form.append("input_fidelity", "high");
    form.append("n", "1");
    form.append("image", new Blob([fs.readFileSync(path.resolve(a.image))]), path.basename(a.image));
    const resp = await requestJson(`${creds.base}/images/edits`, {
      method: "POST", headers: { authorization: `Bearer ${creds.key}` }, body: form,
    }, 300000);
    const item = resp?.data?.[0];
    if (!item) throw new Error("响应中没有图片数据");
    const target = path.resolve(a.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (item.b64_json) fs.writeFileSync(target, Buffer.from(item.b64_json, "base64"));
    else if (item.url) await download(item.url, target);
    else throw new Error("响应既无 b64_json 也无 url");
    return { op: "bg-remove", provider: "cloud", model: creds.model, out: target, note: "云端抠图（images/edits background=transparent）" };
  } catch (error) {
    if (a.provider === "cloud") fail(`云端抠图失败: ${error.message}`);
    const result = local();
    result.note = `云端抠图失败（${error.message}），已降级本地纯色背景抠图`;
    return result;
  }
}

/* ---------- 云端局部重绘 ---------- */
async function eraseViaDashscope(a) {
  const key = dashscopeKey();
  if (!key) throw new Error("缺少 DASHSCOPE_API_KEY / VISION_API_KEY");
  const base = imageSize(a.image);
  const mask = imageSize(a.mask);
  if (base.width !== mask.width || base.height !== mask.height) {
    throw new Error(`掩码与原图尺寸不一致（${mask.width}x${mask.height} vs ${base.width}x${base.height}）：请先在编辑器里对齐，或 resize 掩码`);
  }
  if (base.width < 512 || base.height < 512 || base.width > 4096 || base.height > 4096) {
    throw new Error(`wanx2.1-imageedit 要求宽高在 512–4096（当前 ${base.width}x${base.height}）`);
  }
  const prompt = a.prompt || "remove the brushed content and fill it with the surrounding background naturally";
  const submit = await requestJson(`${dashscopeBase()}/api/v1/services/aigc/image2image/image-synthesis`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model: ENV.EDIT_IMAGE_MODEL || "wanx2.1-imageedit",
      input: { function: "description_edit_with_mask", prompt, base_image_url: dataURLFromFile(a.image), mask_image_url: dataURLFromFile(a.mask) },
      parameters: { n: 1, watermark: false },
    }),
  }, 120000);
  const taskId = submit?.output?.task_id;
  if (!taskId) throw new Error(`提交任务失败: ${JSON.stringify(submit).slice(0, 300)}`);
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const task = await requestJson(`${dashscopeBase()}/api/v1/tasks/${taskId}`, { headers: { authorization: `Bearer ${key}` } }, 60000);
    const status = task?.output?.task_status;
    if (status === "SUCCEEDED") {
      const url = task.output?.results?.[0]?.url || task.output?.output_image_url;
      if (!url) throw new Error(`任务成功但无结果 URL: ${JSON.stringify(task.output).slice(0, 200)}`);
      await download(url, a.out);
      return { provider: "dashscope", model: ENV.EDIT_IMAGE_MODEL || "wanx2.1-imageedit", taskId, out: path.resolve(a.out) };
    }
    if (status === "FAILED" || status === "CANCELED") {
      throw new Error(`任务 ${status}: ${task?.output?.message || JSON.stringify(task.output).slice(0, 200)}`);
    }
  }
  throw new Error(`任务超时（task ${taskId}）`);
}

async function eraseViaOpenAI(a, maskPath) {
  const creds = openaiCreds();
  if (!creds.base || !creds.key) throw new Error("缺少 IMG_BASE_URL / IMG_API_KEY（或 OPENAI_API_KEY）");
  const form = new FormData();
  form.append("model", creds.model);
  form.append("prompt", a.prompt || "Remove the content inside the masked area and fill it with the surrounding background naturally.");
  form.append("n", "1");
  form.append("image", new Blob([fs.readFileSync(path.resolve(a.image))]), path.basename(a.image));
  form.append("mask", new Blob([fs.readFileSync(maskPath)]), path.basename(maskPath));
  const resp = await requestJson(`${creds.base}/images/edits`, {
    method: "POST", headers: { authorization: `Bearer ${creds.key}` }, body: form,
  }, 300000);
  const item = resp?.data?.[0];
  if (!item) throw new Error("响应中没有图片数据");
  if (item.b64_json) {
    fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
    fs.writeFileSync(path.resolve(a.out), Buffer.from(item.b64_json, "base64"));
  } else if (item.url) await download(item.url, a.out);
  else throw new Error("响应既无 b64_json 也无 url");
  return { provider: "openai", model: creds.model, out: path.resolve(a.out) };
}

/** 无掩码通道的兜底：把涂抹区域涂红做成参考图，走整体 i2i，再用掩码合成守住未涂抹区域。 */
function eraseViaI2i(a, overlay, binaryMask) {
  const out = path.resolve(a.out);
  const prompt = [
    `把图中被红色半透明高亮覆盖的区域改成干净的背景：${a.prompt || "抹掉该区域的内容，用周围背景自然填补"}。`,
    "高亮区域必须与周围背景无缝衔接，不要在其中画任何新物体、色块或圆形；高亮区域之外的所有像素保持不变。",
  ].join("");
  const generated = runGenerateImage(prompt, overlay, null);
  // 安全网：只有掩码内的像素采用生成结果，掩码外一律回贴原图（模型漂移不再污染整图）
  try {
    const base = readRaster(a.image);
    const mask = readRaster(binaryMask);
    writePng(out, compositeWithMask(base, readRaster(generated.files[0]), mask));
    return { provider: generated.provider, model: generated.model, out, overlay, source: generated.files[0], composited: true };
  } catch (error) {
    fs.copyFileSync(generated.files[0], out);
    return {
      provider: generated.provider, out, overlay, source: generated.files[0], composited: false,
      note: `结果未能按掩码合成（${error.message}），已直接采用生成图`,
    };
  }
}

async function opErase(a) {
  if (!a.image || !a.mask || !a.out) fail("erase 需要 --image --mask --out");
  const binaryMask = tempPng(binarizeRaster(readRaster(a.mask), a.threshold), "mask-binary.png");
  const attempts = [];
  const tryList = a.provider === "auto"
    ? [dashscopeKey() ? "dashscope" : null, (openaiCreds().base && openaiCreds().key) ? "openai" : null, "i2i"].filter(Boolean)
    : [a.provider];
  for (const candidate of tryList) {
    try {
      if (candidate === "dashscope") {
        const detail = await eraseViaDashscope({ ...a, mask: binaryMask });
        return { op: "erase", maskSemantics: "white = edit", base: detail.out, attempts, ...detail };
      }
      if (candidate === "openai") {
        const alphaMask = tempPng(maskToAlphaRaster(readRaster(binaryMask)), "mask-alpha.png");
        const detail = await eraseViaOpenAI(a, alphaMask);
        return { op: "erase", maskSemantics: "alpha=0 = edit", base: detail.out, attempts, ...detail };
      }
      if (candidate === "i2i") {
        const overlay = tempPng(overlayMaskRaster(readRaster(a.image), readRaster(binaryMask)), "overlay.png");
        const detail = eraseViaI2i(a, overlay, binaryMask);
        return { op: "erase", maskSemantics: "overlay red = edit (合成守边)", attempts, ...detail };
      }
      throw new Error(`未知 provider: ${candidate}`);
    } catch (error) {
      attempts.push({ provider: candidate, error: error.message });
    }
  }
  fail(`erase 全部通道失败:\n${attempts.map((x) => `  - ${x.provider}: ${x.error}`).join("\n")}`);
}

/* ---------- op: local-edit（按标记裁剪 → 局部重绘 → 守边贴回） ---------- */
async function opLocalEdit(a) {
  if (!a.image || !a.markers || !a.out) fail("local-edit 需要 --image --markers --out");
  const markers = parseMarkers(a.markers);
  if (markers.length === 0) fail("local-edit 需要至少一个标记");
  const base = readRaster(a.image);
  const minDim = Math.min(base.width, base.height);
  const radius = (a.radius > 0 ? a.radius : 0.12) * minDim;
  const padding = a.padding > 0 ? a.padding : 0.6;

  // 标记包围盒 → 外扩成一块上下文足够的裁剪区（模型需要看到周边面料/光线）
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const marker of markers) {
    const cx = marker.x * base.width;
    const cy = marker.y * base.height;
    minX = Math.min(minX, cx - radius); maxX = Math.max(maxX, cx + radius);
    minY = Math.min(minY, cy - radius); maxY = Math.max(maxY, cy + radius);
  }
  const wanted = Math.max(768, Math.round(Math.max(maxX - minX, maxY - minY) * (1 + padding)));
  const width = Math.min(base.width, wanted);
  const height = Math.min(base.height, wanted);
  // --crop x,y,w,h 显式指定裁剪框（图像像素坐标）；不给就按标记包围盒居中取方形
  const explicitCrop = /^\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+$/.test(a.crop) ? a.crop.split(",").map(Number) : null;
  const crop = explicitCrop
    ? cropRect(base, explicitCrop[0], explicitCrop[1], explicitCrop[2], explicitCrop[3])
    : cropRect(base, (minX + maxX) / 2 - width / 2, (minY + maxY) / 2 - height / 2, width, height);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "img2img-local-"));
  const cropPath = writePng(path.join(work, "crop.png"), crop.raster);
  const cropMarkers = markers.map((marker) => ({
    id: marker.id,
    x: (marker.x * base.width - crop.x) / crop.width,
    y: (marker.y * base.height - crop.y) / crop.height,
    text: marker.text,
  }));
  // --mask-rect / --mask-ellipse x,y,w,h（图像像素坐标）把可改区域限制成一条带：
  // 想「只改眼睛以下」时比圆形标记更可控；椭圆 + 大羽化的接缝比矩形自然
  const explicitRect = /^\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+$/.test(a.maskRect) ? a.maskRect.split(",").map(Number) : null;
  const explicitEllipse = /^\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+$/.test(a.maskEllipse) ? a.maskEllipse.split(",").map(Number) : null;
  const shapeRect = explicitEllipse ?? explicitRect;
  const cropMask = shapeRect
    ? (explicitEllipse ? maskEllipseRaster : maskRectRaster)(crop.width, crop.height, {
      x: shapeRect[0] - crop.x, y: shapeRect[1] - crop.y, width: shapeRect[2], height: shapeRect[3],
    })
    : maskFromMarkers(crop.width, crop.height, cropMarkers, radius / Math.min(crop.width, crop.height));
  const cropMaskPath = writePng(path.join(work, "crop-mask.png"), cropMask);
  const patchPath = path.join(work, "patch.png");
  const markerText = markers.map((marker) => marker.text).filter(Boolean).join("；");
  const prompt = [
    a.prompt || markerText || "按高亮区域的要求重绘这一小块",
    a.highlight === "none"
      ? "这是从整图裁下的一小块局部放大图，目标位置就在本图正中心；只改中心这一处，周围的面料质感、刺绣纹样、光线方向与褶皱必须完全保持一致。"
      : "这是从整图裁下的一小块（局部放大图），只修改红色高亮圈出的位置；周围的面料质感、刺绣纹样、光线方向与褶皱必须完全保持一致；不要画出红色标记本身。",
  ].join("");
  const erase = a.highlight === "none"
    // 不给高亮：直接把裁剪图交给模型（局部放大图 + 「目标在正中心」），避免红色被画进结果
    ? (() => {
      const generated = runGenerateImage(prompt, cropPath, patchPath, a.genProvider);
      return { provider: generated.provider, model: generated.model, attempts: [] };
    })()
    : await opErase({
      image: cropPath, mask: cropMaskPath, out: patchPath, prompt,
      provider: a.provider, threshold: a.threshold,
    });
  // 两道守边：补丁 → 裁剪图（掩码内），裁剪图 → 原图（整块贴回）
  const patched = compositePatch(crop.raster, readRaster(patchPath), 0, 0, cropMask, a.feather);
  const out = writePng(a.out, compositePatch(base, patched, crop.x, crop.y, null));
  // 诊断：掩码内到底改了多少（模型没动 / 只把高亮留在图里时一眼看出来）
  let changed = 0;
  let inside = 0;
  for (let index = 0; index < cropMask.width * cropMask.height; index++) {
    const i = index * 4;
    if (cropMask.data[i] < 128) continue;
    inside++;
    if (Math.abs(patched.data[i] - crop.raster.data[i]) > 12) changed++;
  }
  const changedRatio = inside === 0 ? 0 : Number((changed / inside).toFixed(3));
  return {
    op: "local-edit",
    out,
    provider: erase.provider,
    crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
    radiusPx: Math.round(radius),
    patch: patchPath,
    changedRatio,
    attempts: erase.attempts,
    note: changedRatio < 0.05
      ? "⚠️ 掩码内几乎没变化：模型可能没按要求改（换 --highlight overlay，或修好 DashScope key 走掩码通道）"
      : "已按掩码守边贴回：裁剪框与掩码以外的像素与原图完全一致",
  };
}

/* ---------- op: manifest（面板交回的编辑请求） ---------- */
async function opManifest(a) {
  if (!a.manifest) fail("manifest 需要 --manifest <edit.json | JSON 字符串>");
  const inline = a.manifest.trim().startsWith("{");
  const manifestPath = inline ? "" : path.resolve(a.manifest);
  if (!inline && !fs.existsSync(manifestPath)) fail(`manifest 不存在: ${manifestPath}`);
  const manifest = inline
    ? JSON.parse(a.manifest.replace(/^\uFEFF/, "").trim())
    : readJsonFile(manifestPath);
  const manifestDir = inline ? path.resolve(a.imageDir || process.cwd()) : path.dirname(manifestPath);
  const workDir = path.resolve(a.outDir || path.join(manifestDir, "edited"));
  fs.mkdirSync(workDir, { recursive: true });
  const steps = [];
  const baseName = manifest?.files?.edited || manifest?.files?.marked;
  if (!baseName) fail("manifest 缺少 files.edited（面板导出的底图文件名）");
  const baseImage = path.join(manifestDir, baseName);
  if (!fs.existsSync(baseImage)) fail(`manifest 里的底图不存在: ${baseImage}`);
  const maskName = manifest?.files?.mask;
  const maskImage = maskName ? path.join(manifestDir, maskName) : "";
  let current = baseImage;

  // 尺寸：面板已按用户设定导出，只有显式给了 --size 才再次调整（改尺寸会让掩码失配，慎用）
  if (a.size) {
    const out = path.join(workDir, "01-resized.png");
    steps.push(opResize({ image: current, out, size: a.size, mode: a.mode, quality: a.quality }));
    current = out;
  }

  if (manifest?.bgRemove?.requested) {
    const out = path.join(workDir, "02-bg-removed.png");
    steps.push(await opBgRemove({ image: current, out, provider: a.provider, tolerance: manifest.bgRemove?.tolerance ?? 36 }));
    current = out;
  }

  if (maskImage && fs.existsSync(maskImage) && (manifest?.erase?.strokes ?? 0) > 0) {
    const out = path.join(workDir, "03-erased.png");
    steps.push(await opErase({
      image: current, mask: maskImage, out,
      prompt: manifest.erase?.prompt || a.prompt, provider: a.provider, threshold: a.threshold,
    }));
    current = out;
  }

  const markers = Array.isArray(manifest?.markers) ? manifest.markers : [];
  const result = {
    op: "manifest",
    manifest: inline ? "(inline)" : manifestPath,
    base: current,
    outDir: workDir,
    markers,
    steps,
    source: manifest?.source ?? null,
    size: manifest?.size ?? null,
    next: a.generate
      ? "已请求生成（见 generated）"
      : "下一步可选：① 有标记时 mask-from-markers 生成掩码再 erase；② generate_image.mjs --image <base> --prompt \"...\" 出图",
  };

  if (a.generate) {
    const scratch = path.join(workDir, "generated");
    const markerText = markers
      .map((m) => `${m.id}. (x ${(m.x * 100).toFixed(1)}%, y ${(m.y * 100).toFixed(1)}%) ${m.text || ""}`.trim())
      .join("；");
    const prompt = [a.prompt, markerText ? `按标记修改：${markerText}。标记只作位置指引，不要出现在成图里。` : ""]
      .filter(Boolean).join(" ");
    try {
      const generated = runGenerateImage(prompt, current, null);
      result.generated = generated.files;
      result.provider = generated.provider;
    } catch (error) {
      result.generateError = error.message;
    }
  }
  return result;
}

/* ---------- main ---------- */
const USAGE = `img2img-studio edit_image.mjs v${VERSION}

用法:
  node scripts/edit_image.mjs info --image in.png
  node scripts/edit_image.mjs resize --image in.png --size 1024x1024 --mode cover --out out.png
  node scripts/edit_image.mjs bg-remove --image in.png --out cutout.png [--provider auto|cloud|local] [--tolerance 36]
  node scripts/edit_image.mjs erase --image in.png --mask mask.png --prompt "..." --out out.png [--provider auto|dashscope|openai|i2i]
  node scripts/edit_image.mjs markers --image in.png --markers markers.json --out marked.png
  node scripts/edit_image.mjs mask-from-markers --markers markers.json --like in.png --out mask.png [--radius 0.03]
  node scripts/edit_image.mjs local-edit --image in.png --markers markers.json --prompt "..." --out out.png [--radius 0.12] [--padding 0.6] [--highlight overlay|none]
  node scripts/edit_image.mjs manifest --manifest edit.json --out-dir out [--generate] [--size 1:1] [--prompt "..."]

掩码语义: 面板/涂抹掩码 白(255)=要处理区域 → wanx 直接可用；OpenAI 需 alpha=0（脚本自动转）。
标记文件: [{"id":1,"x":0.5,"y":0.47,"text":"把这里换成..."}]（x/y 为归一化坐标）。
local-edit: 按标记裁一块局部放大图 → 局部重绘 → 按掩码守边贴回（裁剪框与掩码外像素与原图一致）。`;

async function main() {
  const a = parseArgs(process.argv.slice(2));
  JSON_MODE = a.json === true;
  if (a.help || !a.op) {
    console.log(USAGE);
    process.exitCode = a.op ? 0 : 1;
    return;
  }
  const emit = (result) => {
    if (JSON_MODE) { console.log(JSON.stringify(result, null, 2)); return; }
    console.log(`OK: ${result.op} → ${result.out || result.base || result.image || ""}`);
    if (result.op === "info") console.log(`  尺寸: ${result.width}×${result.height} (${result.format})`);
    if (result.crop) console.log(`  裁剪区: ${result.crop.width}×${result.crop.height} @ (${result.crop.x},${result.crop.y})  标记半径 ${result.radiusPx}px`);
    if (result.changedRatio !== undefined) console.log(`  掩码内改动比例: ${(result.changedRatio * 100).toFixed(1)}%`);
    if (result.provider) console.log(`  通道: ${result.provider}${result.model ? ` (${result.model})` : ""}`);
    if (result.note) console.log(`  说明: ${result.note}`);
    if (result.maskSemantics) console.log(`  掩码语义: ${result.maskSemantics}`);
    if (result.attempts?.length) console.log(`  尝试: ${result.attempts.map((x) => `${x.provider}✗ ${x.error}`).join(" | ")}`);
    if (result.steps?.length) console.log(`  步骤: ${result.steps.map((s) => s.op + (s.provider ? `(${s.provider})` : "")).join(" → ")}`);
    if (result.generated?.length) console.log(`  生成: ${result.generated.join(", ")}`);
    if (result.next) console.log(`  ${result.next}`);
  };
  switch (a.op) {
    case "info": emit({ op: "info", image: path.resolve(a.image), ...imageSize(a.image) }); break;
    case "resize": emit(opResize(a)); break;
    case "bg-remove": emit(await opBgRemove(a)); break;
    case "erase": emit(await opErase(a)); break;
    case "markers": emit(opMarkers(a)); break;
    case "mask-from-markers": emit(opMaskFromMarkers(a)); break;
    case "local-edit": emit(await opLocalEdit(a)); break;
    case "manifest": emit(await opManifest(a)); break;
    default: fail(`未知 op: ${a.op}\n\n${USAGE}`);
  }
}

main().catch((error) => {
  if (error instanceof CliError) console.error(`edit_image: ${error.message}`);
  else console.error(`edit_image: ${error?.stack || String(error)}`);
  process.exitCode = 1;
});
