# 直连通道 `direct` · DSH 本地化指南

`direct` 是 img2img-studio **自有的第二套生成通道**：12 家官方 API 直连，引擎位于本技能自带目录
`engines/direct-api/`，已并入 `scripts/generate_image.mjs` 的供应商链（`--provider direct`）。

## 引擎位置

```
engines/direct-api/
  GUIDE.md            # 引擎 CLI 说明
  LICENSE             # 上游 MIT 许可（保留版权声明）
  scripts/main.ts     # 主脚本（bun 运行，无构建步骤）
  scripts/providers/  # 12 家供应商实现
  references/         # 用法 / 首次设置 / provider 差异
```

## 运行环境

- 需要 **bun**（TypeScript 运行时）：`npm i -g bun`（已装，v1.3.14）
- 配置：`~/.img2img-studio/direct-api/EXTEND.md`（已预置默认 `dashscope` + `qwen-image-3.0-pro`）

## 命令（DSH 环境）

```powershell
# 推荐：走统一入口
node "scripts\generate_image.mjs" --provider direct --direct-provider dashscope --prompt "..." --size 1:1 --output-dir "输出目录"
node "scripts\generate_image.mjs" --provider direct --direct-provider google --prompt "..." --image "参考图.png" --size 3:4 --output-dir "输出目录"

# 直接调引擎（需要引擎原生能力时）
bun "engines\direct-api\scripts\main.ts" --prompt "..." --provider dashscope --image "out.png" --json
bun "engines\direct-api\scripts\main.ts" --prompt "..." --ref "参考图.png" --provider openai --image "out.png"
bun "engines\direct-api\scripts\main.ts" --prompt "..." --ar 16:9 --quality 2k --n 2 --provider zai --image "out.png"
bun "engines\direct-api\scripts\main.ts" --batchfile batch.json --jobs 4
```

## 12 家子通道 → key 来源（与 dsh-vision-config 面板/现有 .env 同源）

| 子通道 | 环境变量 | 面板条目 |
|---|---|---|
| dashscope | `DASHSCOPE_API_KEY`（适配器自动桥接 `VISION_API_KEY`）| DashScope 通义千问 |
| openai | `OPENAI_API_KEY` / `OPENAI_BASE_URL`（桥接 `IMG_API_KEY` / `IMG_BASE_URL`）| OpenAI 兼容中转 |
| zai | `ZAI_API_KEY` | Z.AI GLM |
| minimax | `MINIMAX_API_KEY` | MiniMax 海螺 |
| seedream | `ARK_API_KEY` | Seedream 豆包 |
| jimeng | `JIMENG_ACCESS_KEY_ID` / `JIMENG_SECRET_ACCESS_KEY` | （面板未列，可在 .env 补）|
| google / azure / openrouter / replicate / agnes | 各自 key | （需自行申请）|
| codex-cli | Codex 登录态 | （复用 Codex 订阅）|

> 面板「保存配置」会把这些 key 写进 `img2img-studio/scripts/.env` 或 `dsh-vision-skill/scripts/.env`；
> 引擎运行前读同一批环境变量，天然复用。

## 与 generate_image.mjs 内置通道的分工

| 场景 | 用哪个 |
|---|---|
| 电商套图/多图并发/风格化（photo-art/ecommerce）| `generate_image.mjs` 内置通道（首层路由）|
| 12 家官方 API 直连、Google/Azure/Replicate 等 | `--provider direct --direct-provider <子通道>` |
| Qoder ImageGen / chatgpt-web | `generate_image.mjs`（CLI/浏览器通道）|
| 身份保持参考图 | 两者皆可；`direct` 的 `--ref` 支持面更广 |

## 已知坑

- DashScope 账号欠费时 qwen-image 返回 400 `Arrearage`——换子通道或充值
- 首次运行若 EXTEND.md 缺失会进入交互式首次设置（DSH 里请直接读本指南已预置的配置）
- Windows 上 `bun` 只有 `.ps1`/`.cmd` shim，脚本内部 spawn 请用 `bun.exe` 完整路径（`resolveBunBinary()` 已处理）
