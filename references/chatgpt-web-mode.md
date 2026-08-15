# chatgpt-web 模式（ChatGPT 网页端出图）

通过**可见浏览器自动化**直接操作 ChatGPT 网页生成图片（用 ChatGPT 账号的 gpt-image 额度，无需 API key）。
这是「调用 chatgpt 网页端」的可行路径：ChatGPT-to-API 类 Go 代理因 Cloudflare JA3 指纹拦截（403）在 2026 年基本失效，而真实浏览器（含登录态）能稳定过 Cloudflare。

## 前置条件

- 一个**已登录 ChatGPT** 的可见浏览器（Playwright 管理的有头浏览器，登录态存在于其 context）
- 浏览器可经系统代理/Clash 访问 chatgpt.com
- ChatGPT 账号（免费版也有 gpt-image 每日额度）

## 工作流（agent 执行）

1. **确认登录态**：`browser_navigate` 到 `https://chatgpt.com`；若显示「登录」，请用户在弹出的浏览器窗口里登录（不要把密码发到聊天）。
2. **新开聊天**：点侧边栏「新聊天」或访问 `https://chatgpt.com/`。
3. **输入并发送**：
   - `browser_type` 填入图片需求 prompt（textbox "与 ChatGPT 聊天"）
   - 发送按钮出现后点击（`data-testid="send-button"`）
   - 会话标题会自动生成（说明对话已受理）
4. **等待生成**：gpt-image 生成约 30-120 秒。用 `browser_wait_for`（≤15 秒/次）分段等待，多次检查 `main img` 是否出现（图片 URL 形如 `https://chatgpt.com/backend-api/estuary/content?id=...`）。
5. **保存图片**：
   - 快照定位图片元素 → `browser_take_screenshot`（element + 相对文件名，如 `device`）→ 文件落在 MCP 输出目录（`<MCP工作目录>/device`，具体路径以环境为准，可用 PowerShell 搜索最近生成的 device 文件）
   - 用 PowerShell 复制到目标目录并重命名（如 `F:\...\output.png`），用 Node 校验 PNG 头/尺寸
6. **交付**：报告图片路径 + 生成所用的会话链接。

## 与 img2img-studio 主流程的衔接

- Layer 1 识图照常（vision.js），Layer 2 的「生成」在用户明确要 ChatGPT 网页端时走本流程；否则走 `generate_image.mjs`（DashScope 等 API）。
- 参考图（i2i）：ChatGPT 网页支持上传附件后让 gpt-image 编辑/融合——在输入框旁点「添加文件等」上传原图，再发编辑指令（如「保留这个杯子的造型，换成木质桌面场景」）。上传后图片会出现在会话中，模型会基于它生成。

## 已知约束

- **需要浏览器会话在线**：出图期间浏览器窗口不能关；MCP 重启后登录态可能丢失（需要重新登录一次）。
- **登录态不持久**：Playwright 的 context 是会话级的；长期使用建议每次先检查登录态。
- **图片分辨率**：网页生成默认约 1024 或 480-2048 不等（按模型）；需要更大图可让模型「生成 2K 版本」或放大。
- **免费额度**：免费版 gpt-image 每日有限额，超限会提示升级。
- **不能静默后台跑**：浏览器自动化出图是可见操作，会占用用户屏幕上的浏览器窗口。

## 安全

- 浏览器中的 ChatGPT 登录态 = 账号访问权。操作完可退出登录（页面右上角头像 → 退出），或保持登录但注意别把 cookie/token 贴到聊天。
- 若已把 session token 写入配置文件（如 `F:\dsh\chatgpt-web-proxy\cookies.json`），该文件等同账号凭据，注意保管；不再使用可删除。
