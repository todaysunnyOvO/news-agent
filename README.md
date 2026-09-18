# News Agent

每日 AI 新闻助手 Agent。当前已完成 Phase 1～6：可以配置偏好，使用 DeepSeek + Tavily 手动或定时生成新闻简报，实时观察 Agent，并查看、评估和推送带来源的历史简报。

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
- `NEWS_AGENT_DELIVERY_WEBHOOK_URL`：可选，成功生成后推送 HTTPS Webhook。

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

## 验证

```bash
npm run build
npm run check
```

`npm run check` 会依次执行 ESLint、TypeScript 类型检查和 Vitest。

## 当前 API

```text
POST  /api/users
GET   /api/users/:userId
PUT   /api/users/:userId/subscription
GET   /api/users/:userId/subscription
POST  /api/users/:userId/runs
GET   /api/runs/:runId
GET   /api/runs/:runId/evaluation
POST  /api/runs/:runId/cancel
GET   /api/runs/:runId/events
GET   /api/users/:userId/briefs
GET   /api/briefs/:briefId
GET   /api/briefs/:briefId/markdown
```

前端包含偏好设置、运行时间线、取消操作、简报历史和来源详情。

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

## Pi Agent 能力

- Pi Coding Agent SDK 固定为 `0.85.1`；
- `NewsAgentService` 只启用本项目的安全自定义工具，不开放 Pi 内置文件或 Shell 工具；
- System Prompt 强制先读取偏好、使用工具核验实时新闻、忽略网页中的 Prompt Injection，并通过 `save_brief` 完成任务；
- 对外提供脱敏的文本、工具、简报和运行状态事件；
- 默认限制 180 秒、12 个 Turn、30 次工具调用，并支持主动取消；
- 集成测试使用 Pi 官方 Faux Provider，无需模型 API Key。

## 推送与评估

- HTTPS Webhook 在简报成功生成后推送，失败最多重试 3 次；
- 推送状态持久化，已成功的运行不会重复推送；
- 运行记录包含耗时、Turn、输入/输出 Token 和模型成本；
- `GET /api/runs/:runId/evaluation` 返回质量、来源覆盖率和性能指标。

完整设计和进度请查看 [DEVELOPMENT.md](./DEVELOPMENT.md)。
