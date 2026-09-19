# News Agent

个人每日高质量新闻助手。MVP Phase 1～6、R2 Phase 1～4 和 UX R1 均已完成：可配置显式偏好，通过反馈形成可控的个性化画像，使用 DeepSeek + Tavily 手动或定时生成分层简报，并通过站内、Resend 邮件或 Webhook 送达。

## 环境要求

- Node.js 22+
- npm 11+

## 安装

```bash
npm install
```

## 开发运行

先复制 `.env.example` 为 `.env`，填写：

- `DEEPSEEK_API_KEY`：真实模型调用；
- `TAVILY_API_KEY`：动态新闻搜索；
- `NEWS_AGENT_DELIVERY_WEBHOOK_URL`：可选，成功生成后推送 HTTPS Webhook；
- `RESEND_API_KEY`、`NEWS_AGENT_EMAIL_FROM`、`NEWS_AGENT_EMAIL_TO`：可选但必须成组配置，用于 Resend 邮件投递；
- `NEWS_AGENT_PUBLIC_BASE_URL`：邮件中的简报和快捷反馈链接基础地址；
- `NEWS_AGENT_FEEDBACK_SIGNING_SECRET`：启用邮件时必填，至少 32 个随机字符。

真实密钥和个人邮箱只写入本地 `.env`，不要提交到 Git。项目不需要为 R2 Phase 4 增加任何新环境变量。

API 启动时若检测到 DeepSeek 和 Tavily Key，会自动启用真实运行时；缺少任一 Key 时回退到 Pi Faux Model 和 Mock News Provider，便于离线演示。

分别打开两个终端：

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Web：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:3000>
- 健康检查：<http://127.0.0.1:3000/health>

## 使用流程

- 首次创建本地身份后，按“关注内容 → 时间安排 → 接收方式”三个步骤完成设置，并生成第一份简报。
- 已有用户默认进入“今日”，直接阅读今天或最近的简报；往期简报也在同一页面选择。
- 每条新闻默认只显示“有帮助”“不喜欢”和“收藏”；点击“不喜欢”后再选择具体原因，收藏后可继续追踪。
- 订阅设置按内容、时间和接收方式分区。修改会先保留为草稿，明确保存后才影响生成和投递。
- 投递区域优先显示“仅站内”“发送中”“已发送”或“发送失败”等结果；只有失败时突出重新发送。
- 个性化画像、运行详情和质量概览位于设置页的“个性化与诊断”区域，不占用一级导航。

界面保持三个一级入口：“今日”“收藏与追踪”“设置”。自动化检查验证了主要状态规则和兼容路径，但不等同于真实用户体验验收。

## 验证

```bash
npm run build
npm run check
```

`npm run check` 会依次执行 ESLint、TypeScript 类型检查和 Vitest。

生产依赖可用 `npm audit --omit=dev` 检查，当前结果为 0 个漏洞。完整开发依赖树仍由 `drizzle-kit` 的旧版开发服务器链路带来 4 个 moderate 告警，审计工具当前标记为无可用修复；该链路不进入生产运行时，开发服务默认仅绑定本机地址。

## 当前 API

```text
POST  /api/users
GET   /api/users/:userId
PUT   /api/users/:userId/subscription
GET   /api/users/:userId/subscription
POST  /api/users/:userId/subscription/skip-today
GET   /api/users/:userId/preference-profile
PATCH /api/users/:userId/personalization
PATCH /api/inferred-preferences/:preferenceId
DELETE /api/inferred-preferences/:preferenceId
POST  /api/users/:userId/runs
GET   /api/runs/:runId
GET   /api/runs/:runId/evaluation
POST  /api/runs/:runId/cancel
GET   /api/runs/:runId/events
GET   /api/users/:userId/briefs
GET   /api/briefs/:briefId
GET   /api/briefs/:briefId/markdown
PUT   /api/briefs/:briefId/feedback
GET   /api/briefs/:briefId/feedback
PUT   /api/brief-items/:itemId/feedback/:type
DELETE /api/brief-items/:itemId/feedback/:type
PUT   /api/brief-items/:itemId/saved
DELETE /api/brief-items/:itemId/saved
POST  /api/brief-items/:itemId/tracking
GET   /api/users/:userId/saved-items
GET   /api/users/:userId/tracked-topics
PATCH /api/tracked-topics/:trackingId
GET   /api/briefs/:briefId/deliveries
POST  /api/briefs/:briefId/deliver
POST  /api/deliveries/:deliveryId/retry
GET   /api/users/:userId/metrics
GET   /api/users/:userId/version-comparison
```

前端包含订阅设置、个性化画像、质量概览、运行时间线、简报反馈、收藏追踪、投递状态和兼容 R1/R2 的历史详情。

## 当前工具

- `list_dir(path)`：列出用户工作目录内容；
- `read_file(path)`：读取 UTF-8 文本并限制返回长度；
- `search_content(keyword, dir)`：搜索 Markdown、JSON 和文本文件；
- `write_file(path, content)`：原子写入 `.md`、`.json`、`.txt`；
- `bash(command)`：执行白名单命令，不开放任意 Shell。

所有工具均限制在 `data/users/<user-id>/workspace/`，并提供 TypeBox Schema、审计事件、超时和输出上限。

## 新闻能力

- `MockNewsProvider`：测试环境完全离线；
- `RssNewsProvider`：支持多个 RSS/Atom Feed；
- `TavilyNewsProvider`：支持动态关键词、时间和语言过滤，并对结果正文做安全抓取；
- Readability + JSDOM 正文抽取，失败时回退到 RSS 摘要；
- URL 规范化、正文哈希和标题相似度去重；
- 同事件语义聚类、独立来源计数和交叉验证标记；
- 新闻元数据与正文缓存到 SQLite；
- SSRF 基础防护、重定向/超时/响应大小限制。

当前领域工具：

- `get_user_preferences`
- `search_news`
- `fetch_article`
- `find_related_articles`
- `save_brief`

`save_brief` 会校验引用文章 ID，并同时保存结构化数据库记录和 Markdown 简报。
R2 条目可选包含栏目、进展类型、推荐原因和证据状态；旧简报缺少这些字段时仍可正常读取。

## Pi Agent 能力

- Pi Coding Agent SDK 固定为 `0.85.1`；
- `NewsAgentService` 只启用本项目的安全自定义工具，不开放 Pi 内置文件或 Shell 工具；
- System Prompt 强制先读取偏好、使用工具核验实时新闻、忽略网页中的 Prompt Injection，并通过 `save_brief` 完成任务；
- 对外提供脱敏的文本、工具、简报和运行状态事件；
- 默认限制 180 秒、12 个 Turn、30 次工具调用，并支持主动取消；
- 集成测试使用 Pi 官方 Faux Provider，无需模型 API Key。

## 推送、反馈与评估

- Resend 邮件与 HTTPS Webhook 使用统一投递状态机，临时失败最多重试 3 次；
- 推送状态持久化，已成功的运行不会重复推送；
- 邮件快捷反馈使用限时签名链接；
- 反馈聚合为可查看、接受、调权、忽略和删除的推断偏好；
- 运行记录包含耗时、Turn、输入/输出 Token 和模型成本；
- `GET /api/runs/:runId/evaluation` 返回质量、来源覆盖率和性能指标。
- `GET /api/users/:userId/metrics` 返回近 30 天质量、送达、成本和性能汇总；
- `GET /api/users/:userId/version-comparison` 对比前一周期，并附带固定离线排序回放结果。

MVP 设计见 [DEVELOPMENT.md](./DEVELOPMENT.md)，R2 设计、决策和进度见 [R2_DEVELOPMENT.md](./R2_DEVELOPMENT.md)，UX R1 计划、决策和验证记录见 [UX_DEVELOPMENT.md](./UX_DEVELOPMENT.md)。
