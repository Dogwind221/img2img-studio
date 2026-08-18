# 宝玉生图引擎（baoyu-image-gen）· DSH 本地化指南

img2img-studio 融合了 [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) 的
`baoyu-image-gen` 生图引擎（v2.1.0，宝玉出品），作为 `generate_image.mjs` 之外的
**第二套生成通道**（官方 API 族，支持 12 家供应商）。

## 引擎位置

```
engines/baoyu-image-gen/
  SKILL.md            # 原版 skill 说明（英文）
  scripts/main.ts     # 主脚本（bun 运行，无构建步骤）
  scripts/providers/  # 12 家供应商实现
  references/         # 原版文档（用法/首次设置/schema）
```

## 运行环境

- 需要 **bun**（TypeScript 运行时）：`npm i -g bun`（已装，v1.3.14）
- 配置：`~/.baoyu-skills/baoyu-image-gen/EXTEND.md`（已预置默认 `dashscope` + `qwen-image-3.0-pro`）

## 命令（DSH 环境）

```powershell
# 文生图（单张）
bun "engines/baoyu-image-gen/scripts/main.ts" --prompt "..." --provider dashscope --image "out.png" --json

# 图生图（参考图，Google/OpenAI/DashScope wan2.7 等支持）
bun ".../main.ts" --prompt "..." --ref "参考图.png" --provider openai --image "out.png"

# 指定比例/质量/张数
bun ".../main.ts" --prompt "..." --ar 16:9 --quality 2k --n 2 --provider zai --image "out.png"

# 批量（JSON 批处理文件）
bun ".../main.ts" --batchfile batch.json --jobs 4
```

## 12 家供应商 → key 来源（与 dsh-vision-config 面板/现有 .env 完全同源）

| 供应商 | 环境变量 | 面板条目 |
|---|---|---|
| dashscope | `DASHSCOPE_API_KEY`（复用 `VISION_API_KEY`）| DashScope 通义千问 |
| openai | `OPENAI_API_KEY` / `OPENAI_BASE_URL` | OpenAI 兼容中转 |
| zai | `ZAI_API_KEY` | Z.AI GLM |
| minimax | `MINIMAX_API_KEY` | MiniMax 海螺 |
| seedream | `ARK_API_KEY` | Seedream 豆包 |
| jimeng | `JIMENG_ACCESS_KEY_ID` / `JIMENG_SECRET_ACCESS_KEY` | （面板未列，可在 .env 补）|
| google / azure / openrouter / replicate / agnes | 各自 key | （需自行申请）|
| codex-cli | Codex 登录态 | （复用 Codex 订阅）|

> 提示：面板「保存配置」会把这些 key 写进 `img2img-studio/scripts/.env` 或
> `dsh-vision-skill/scripts/.env`；baoyu 引擎运行前会读同一批环境变量，天然复用。

## 与 generate_image.mjs 的分工

| 场景 | 用哪个 |
|---|---|
| 电商套图/多图并发/风格化（photo-art/ecommerce）| `generate_image.mjs`（首层路由）|
| 12 家官方 API 直连、Google/Azure/Replicate 等 | **宝玉引擎**（本引擎独有）|
| Qoder ImageGen / chatgpt-web | `generate_image.mjs`（CLI/浏览器通道）|
| 身份保持参考图 | 两者皆可；宝玉引擎的 `--ref` 支持面更广 |

## 已知坑

- DashScope 账号欠费时 qwen-image 返回 400 `Arrearage`——引擎会自动报错，换其他 provider 或充值
- 首次运行若 EXTEND.md 缺失会进入交互式首次设置（DSH 里请直接读本指南已预置的配置）
- Windows 上 bun 用 `bun` 命令（已装全局）；无 bun 时可 `npx -y bun`
