#!/usr/bin/env node
/**
 * 发布基线冒烟：确认 npm 上的包确实能装、能加载、没被 peer 上界卡住。
 *
 * 每次 DSH 升级（或发布新版本）后跑一次：
 *   node scripts/smoke-plugin-publish.mjs
 *   node scripts/smoke-plugin-publish.mjs --version 0.1.1
 *
 * 检查内容：
 *   1. registry 上 latest 版本可解析、tarball 可下载
 *   2. 包内含 package.json / cordis.patch.yml / lib/index.js / lib/client.js
 *   3. package.json 的 dsh.bundle.patch 指向的文件真的存在
 *   4. peerDependencies 不含上界（防「静默拒绝加载」）
 *   5. dist.attestations 存在（可信发布 provenance）
 *   6. 可选 --install：在临时目录 npm install 后再校验一次文件落地
 *
 * 退出码：0 全部通过；1 有失败项。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PKG = "dsh-img2img-config";
const args = process.argv.slice(2);
const wantVersion = args.includes("--version") ? args[args.indexOf("--version") + 1] : null;
const doInstall = args.includes("--install");

const results = [];
const ok = (name, detail = "") => results.push({ pass: true, name, detail });
const bad = (name, detail = "") => results.push({ pass: false, name, detail });

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

// 直接跑 npm CLI 的 JS 入口：Windows 下避免 .cmd 的 EINVAL 与 shell 拼接的 DEP0190
const NPM_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npm = (argv, opts = {}) =>
  fs.existsSync(NPM_CLI)
    ? run(process.execPath, [NPM_CLI, ...argv], opts)
    : run(process.platform === "win32" ? "npm.cmd" : "npm", argv, { ...opts, shell: process.platform === "win32" });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-smoke-"));

try {
  // 1) registry 元数据
  const version = wantVersion || npm( ["view", PKG, "version", "--prefer-online"]);
  ok("registry 版本可解析", version);

  const metaRaw = npm( ["view", `${PKG}@${version}`, "--json", "--prefer-online"]);
  const meta = JSON.parse(metaRaw);
  ok("tarball 地址存在", meta.dist?.tarball ?? "");

  // 2) 下载并解包
  const tgz = path.join(tmp, `${PKG}-${version}.tgz`);
  const res = await fetch(meta.dist.tarball);
  if (!res.ok) throw new Error(`下载 tarball 失败: HTTP ${res.status}`);
  fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  ok("tarball 可下载", `${(fs.statSync(tgz).size / 1024).toFixed(1)} KB`);

  run("tar", ["-xzf", tgz, "-C", tmp]);
  const pkgDir = path.join(tmp, "package");

  // 3) 关键文件
  for (const f of ["package.json", "cordis.patch.yml", "lib/index.js", "lib/client.js"]) {
    fs.existsSync(path.join(pkgDir, f)) ? ok(`包内含 ${f}`) : bad(`包内含 ${f}`, "缺失");
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));

  // 4) dsh.bundle 与 patch 文件
  const patch = pkg.dsh?.bundle?.patch;
  if (patch) {
    ok("dsh.bundle.patch 已声明", patch);
    const patchPath = path.join(pkgDir, patch.replace(/^\.\//, ""));
    fs.existsSync(patchPath) ? ok("patch 文件存在", patch) : bad("patch 文件存在", `${patch} 不在包内`);
  } else {
    bad("dsh.bundle.patch 已声明", "只有 dsh.client 无法安装（列表头号拒收原因）");
  }

  // 5) peer 上界
  const peers = pkg.peerDependencies ?? {};
  const bounded = Object.entries(peers).filter(([, r]) => String(r).includes("<"));
  bounded.length === 0
    ? ok("peer 范围无上界", Object.entries(peers).map(([k, v]) => `${k}@${v}`).join(", ") || "(无 peer)")
    : bad("peer 范围无上界", bounded.map(([k, v]) => `${k}@${v}`).join(", "));

  // 6) provenance
  const att = meta.dist?.attestations;
  att?.url ? ok("provenance attestation 存在", att.url) : bad("provenance attestation 存在", "无 attestations（发布时未带 provenance）");

  // 7) 实际安装（可选）
  if (doInstall) {
    const inst = path.join(tmp, "install");
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, "package.json"), JSON.stringify({ name: "smoke", private: true }));
    npm( ["install", `${PKG}@${version}`, "--no-audit", "--no-fund", "--silent"], { cwd: inst });
    const mod = path.join(inst, "node_modules", PKG);
    for (const f of ["package.json", "cordis.patch.yml", "lib/index.js", "lib/client.js"]) {
      fs.existsSync(path.join(mod, f)) ? ok(`安装后 ${f} 落地`) : bad(`安装后 ${f} 落地`, "缺失");
    }
    const installed = JSON.parse(fs.readFileSync(path.join(mod, "package.json"), "utf8"));
    installed.dsh?.bundle?.patch ? ok("安装后 dsh.bundle 仍在") : bad("安装后 dsh.bundle 仍在", "丢失");
  }
} catch (error) {
  bad("执行异常", error && error.message ? String(error.message).split("\n")[0] : String(error));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${PKG} 发布基线冒烟 ===\n`);
for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
console.log(`\n${failed.length ? `✗ ${failed.length} 项失败` : `✓ 全部 ${results.length} 项通过`}\n`);
process.exit(failed.length ? 1 : 0);
