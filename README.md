# img2img-studio · 图生图工作室

把一张图（或几张图）变成你想要的各种新图：**识图 → 按风格/场景 → 按生成通道 → 出图**。

面向 DeepSeek Harness / Claude Code / Codex 等 Agent 环境的可移植 Agent Skill。

## 架构

```
输入图片
  ↓ 第一层：识图（依赖 dsh-vision-skill，见下方「前置依赖」）
  结构化描述（主体/构图/色彩/材质/情绪/卖点）
  ↓ Step 0 路由门（出图前必问）
  ① 选生成通道 → ② 选风格/场景 → ③ 细化需求（尺寸/文字/参考图/数量）
  ↓ 第二层：生成
  模式文档构建 Prompt → generate_image.mjs（多供应商自动降级）→ QA → 交付
```

## 功能

- **电商模式**：商品图 → 白底主图、卖点图、场景图、细节图、对比图、详情页 PDP、Amazon/淘宝等平台套图（转化驱动力诊断 + Campaign Style Lock + 平台尺寸规范 + GPT-Image Prompt 铁律）
- **照片艺术模式**：editorial（编辑杂志）/ revival（白纸手绘诗意）/ fusion（融合）/ **zine 三风格**（zine-gathered 实景拼贴 / zine-distill 影像蒸馏 / zine-minimal 极简海报）
- **ChatGPT 网页出图**：无 API key 也能用 ChatGPT 账号额度出图（浏览器自动化，`references/chatgpt-web-mode.md`）
- **多供应商自动降级**：DashScope 通义千问（默认，性能+最新模型优先）、OpenAI 兼容 API、Z.AI GLM-Image、Seedream 豆包、MiniMax、本地 chatgpt-web 类服务、Codex CLI
- **批量并发出图**、质量预设（1k/2k）、i2i 参考图、同供应商重试、身份保持参考图准则

## 安装

```powershell
# 复制到 Agent 的 skills 目录（Windows 示例）
Copy-Item -Recurse -Force "img2img-studio" "$env:USERPROFILE\.agents\skills\"
```

依赖：Node.js 18+。**前置依赖：dsh-vision-skill**（识图脚本，需放在与 img2img-studio 相同的 skills 目录下，或通过 `DSH_SKILLS_DIR` 环境变量指定；详见 SKILL.md）。

## 快速开始

```powershell
# 1. 查看已配置的生图供应商（不泄露密钥）
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --list-providers

# 2. 文生图（默认 DashScope qwen-image-3.0-pro；零配置即用——自动复用 dsh-vision-skill 的 key）
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --prompt "红色苹果白底产品图" --size 1:1 --output-dir out

# 3. 图生图（带参考图）
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --prompt-file prompt.txt --image ref.png --size 3:4 --output-dir out

# 4. 批量（电商套图）
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --batchfile batch.json --jobs 4 --output-dir out
```

Agent 完整工作流（识图 → 路由门 → 生成 → QA）见 `SKILL.md`。

## 生成通道

| 通道 | 说明 | 前置条件 |
|---|---|---|
| `dashscope`（默认） | 通义千问 qwen-image-3.0-pro，国内直连，t2i+i2i | 零配置（复用识图 key） |
| `chatgpt-web` | ChatGPT 网页 gpt-image | 浏览器登录态 |
| `openai` | OpenAI 兼容 API（gpt-image 等） | `IMG_BASE_URL`+`IMG_MODEL`+`IMG_API_KEY` |
| `zai` | Z.AI GLM-Image（中文文字渲染强，不支持参考图） | `ZAI_API_KEY` |
| `seedream` | 豆包（4.0+ 支持参考图） | `ARK_API_KEY` |
| `minimax` | 海螺 image-01（人物一致性） | `MINIMAX_API_KEY` |
| `local` | 本地 chatgpt-web 类服务 | `IMG_HTTP_URL` |
| `codex-cli` | Codex/ChatGPT 订阅出图 | codex CLI + imagegen 权限 |

配置方式见 `scripts/.env.example`（也可直接用环境变量）。

## 风格清单

**photo-art**：`editorial`（编辑杂志）/ `revival`（白纸手绘诗意）/ `fusion`（默认，融合）/ `zine-gathered`（拾景实景拼贴）/ `zine-distill`（影像蒸馏）/ `zine-minimal`（极简海报）

**ecommerce**：白底主图 / 卖点图 / 场景图 / 细节图 / 对比图 / 平铺图 / 模特图 / 详情页 PDP / 社媒图 / 直播图 / 包装图 / 海报横幅

## 目录结构

```text
img2img-studio/
├── SKILL.md                      # 主入口：L1 识图 + Step 0 路由门 + L2 生成 + 模型策略 + QA
├── references/
│   ├── routing-gate.md           # 出图前询问：通道 + 风格 + 细化需求
│   ├── photo-art-mode.md         # 照片艺术模式（editorial/revival/fusion/zine 三风格）
│   ├── ecommerce-mode.md         # 电商模式（10 步管线：转化诊断/Style Lock/铁律/详情页）
│   └── chatgpt-web-mode.md       # ChatGPT 网页出图工作流
└── scripts/
    ├── generate_image.mjs        # 多供应商生图脚本（零依赖 Node）
    └── .env.example              # 供应商配置示例
```

## 模型策略

性能优先 + 发布时间最近优先（DashScope 默认链）：
- 生图 t2i：`qwen-image-3.0-pro` → `qwen-image-3.0` → `wan2.7-image-pro` → `wanx2.1-t2i-plus` → `wanx2.1-t2i-turbo`
- 生图 i2i：`qwen-image-3.0-pro` → `wan2.7-image-pro`
- 识图（dsh-vision-skill）：`qwen3.8-max` → `qwen3.7-plus` → `qwen3.7-flash` → ...

## License

MIT

## 致谢与风格来源

- 风格融合自多个开源 Skill：`photo-abstract-editorial`、`photo-revival`、`ecommerce-image-suite`、`ecom-details-image`、`1click-ecom-detailpage`、`gpt-image2-ecommerce`、`designkit-skills`（美图）、`gathered-scenes-zine`（Zeejay0，**个人非商业许可**，商用需其授权）、`gc-minimal-zine-poster`
- `engines/direct-api/` 为 MIT 授权的第三方代码（见该目录 `LICENSE`），已重命名为本技能自有通道并完成 DSH 本地化改造
