# 每日 AI 新闻助手 Agent：开发设计文档

> 文档状态：Draft v0.1  
> 项目代号：News Agent  
> 默认技术路线：TypeScript + Node.js + Pi Coding Agent SDK  
> 目标：实现一个能根据用户偏好，自主检索、筛选、阅读、整理并保存每日 AI 新闻简报的垂类 Agent。

## 1. 项目目标

### 1.1 产品目标

用户可以创建自己的新闻订阅配置，包括：

- 用户身份或昵称；
- 关注话题，例如大模型、AI 编程、机器人、芯片；
- 关注关键词，例如 OpenAI、Claude、Agent；
- 排除关键词；
- 新闻语言；
- 简报篇数；
- 推送时间和时区；
- 推送渠道。

系统每天自动触发一次 Agent。Agent 根据用户偏好自主决定：

1. 搜索哪些主题和关键词；
2. 调用哪些工具；
3. 每个工具调用多少次；
4. 阅读哪些候选文章；
5. 如何去重、交叉验证和排序；
6. 何时停止搜索并生成最终简报。

用户可以在网页中查看当日简报及历史简报，也可以手动要求立即生成一份简报。

### 1.2 技术目标

- 使用 Pi Coding Agent SDK 承担 LLM 调用、Tool Calling 循环、消息状态和流式事件；
- 至少提供题目要求的 5 个基础工具；
- 新增新闻领域工具，而不是让模型只依赖 Shell 搜索新闻；
- 工具调用顺序由 LLM 决定，不硬编码成固定流水线；
- 新闻结论可追溯到真实来源；
- 用户文件和 Shell 工具被限制在独立工作目录；
- 支持失败重试、运行日志和基本自动化测试。

### 1.3 非目标

MVP 阶段暂不实现：

- 完整账号密码、OAuth 和企业级权限系统；
- 原生手机 App；
- 面向海量用户的分布式任务调度；
- 对所有新闻网站进行通用爬取；
- 自动发布文章或自动执行投资操作；
- 训练或微调专用模型。

## 2. 为什么使用 Pi Coding Agent SDK

本项目选择 `pi-coding-agent` SDK，而不是直接从 `pi-agent-core` 开始，原因如下：

- 已封装 Agent 会话与生命周期；
- 已实现 LLM 自主 Tool Calling 循环；
- 支持流式事件、重试和上下文压缩；
- 支持内置工具及自定义工具；
- 支持模型、凭证和会话管理；
- 后续可以继续使用 extensions、skills 和资源加载机制。

新闻检索、正文抽取、用户偏好、简报保存等领域能力仍由本项目实现。

> 注意：Pi 项目及包名发生过迁移。正式初始化项目时应以锁定版本对应的官方文档为准，不混用旧版 `@mariozechner/*` 与新版 `@earendil-works/*` API。

## 3. 总体架构

```text
┌───────────────────────┐
│ React Web             │
│ 偏好设置 / 运行过程 / 历史简报 │
└───────────┬───────────┘
            │ HTTP + SSE
            ▼
┌───────────────────────┐
│ Fastify API           │
│ 用户、简报、任务接口        │
└──────┬─────────┬──────┘
       │         │
       │         ▼
       │   ┌────────────────┐
       │   │ Scheduler      │
       │   │ 定时扫描到期订阅    │
       │   └───────┬────────┘
       │           │
       ▼           ▼
┌───────────────────────┐
│ NewsAgentService      │
│ Pi Coding Agent SDK   │
│ Prompt + Custom Tools │
└───────────┬───────────┘
            │
      ┌─────┴───────────────────┐
      ▼                         ▼
┌───────────────┐        ┌───────────────┐
│ News Providers│        │ SQLite        │
│ RSS / Search  │        │ 用户/文章/简报/运行 │
└───────────────┘        └───────────────┘
```

### 3.1 核心边界

- API 层负责请求验证、任务创建和结果读取；
- Scheduler 只负责确定“哪个用户现在需要生成简报”；
- NewsAgentService 负责创建和驱动 Agent；
- Agent 自主选择工具，不直接访问数据库和网络；
- Tool 层是 Agent 与外部世界的唯一受控接口；
- Repository 层负责数据库读写；
- Provider 层屏蔽 RSS、新闻搜索 API 等来源差异。

## 4. 推荐技术栈

| 领域 | 选择 | 说明 |
|---|---|---|
| 语言 | TypeScript | 与 Pi SDK 原生生态一致 |
| 运行时 | Node.js 22+ | 使用稳定 LTS 版本 |
| Agent | Pi Coding Agent SDK | Agent Loop、事件、工具和模型管理 |
| 后端 | Fastify | 简洁、类型友好、性能足够 |
| 前端 | React + Vite | 快速实现设置页和历史页 |
| 数据库 | SQLite | 适合课程项目和单机 MVP |
| ORM | Drizzle ORM | Schema 清晰、迁移简单 |
| 调度 | node-cron | MVP 单机调度 |
| Feed 解析 | rss-parser | 获取 RSS/Atom 内容 |
| 正文抽取 | JSDOM + Mozilla Readability | 清洗普通新闻网页 |
| 参数校验 | TypeBox | 与 Pi Tool Schema 配合 |
| 测试 | Vitest | 单元和集成测试 |
| 日志 | Pino | 与 Fastify 配合 |

依赖版本在项目初始化时统一锁定，并提交 lockfile。

## 5. 项目目录设计

```text
news-agent/
├─ apps/
│  ├─ api/
│  │  └─ src/
│  │     ├─ routes/
│  │     ├─ plugins/
│  │     └─ server.ts
│  └─ web/
│     └─ src/
│        ├─ pages/
│        ├─ components/
│        └─ api/
├─ packages/
│  ├─ agent/
│  │  └─ src/
│  │     ├─ create-news-agent.ts
│  │     ├─ news-agent-service.ts
│  │     ├─ system-prompt.ts
│  │     └─ event-mapper.ts
│  ├─ tools/
│  │  └─ src/
│  │     ├─ filesystem/
│  │     ├─ shell/
│  │     ├─ news/
│  │     └─ preferences/
│  ├─ news/
│  │  └─ src/
│  │     ├─ providers/
│  │     ├─ extractors/
│  │     ├─ deduplicate.ts
│  │     └─ normalize.ts
│  ├─ db/
│  │  └─ src/
│  │     ├─ schema.ts
│  │     ├─ repositories/
│  │     └─ migrations/
│  └─ shared/
│     └─ src/
│        ├─ contracts.ts
│        └─ errors.ts
├─ data/
│  ├─ users/
│  └─ news-agent.sqlite
├─ docs/
├─ tests/
├─ package.json
├─ tsconfig.json
└─ DEVELOPMENT.md
```

建议使用 npm workspaces。MVP 也可先使用单包结构，但模块边界保持不变。

## 6. Agent 设计

### 6.1 Agent 的输入

每次运行都传入明确的任务上下文：

```ts
interface BriefGenerationRequest {
  runId: string;
  userId: string;
  now: string;
  timezone: string;
  mode: "scheduled" | "manual";
}
```

Agent 不直接接收整个数据库对象。它应通过 `get_user_preferences` 工具获取最新偏好。

### 6.2 System Prompt 原则

System Prompt 至少包含以下约束：

1. 近期事实必须通过工具获得，不能依赖模型记忆；
2. 先读取用户偏好，再决定搜索策略；
3. 区分文章发布时间、更新时间和事件发生时间；
4. 关键事实尽量由两个独立来源交叉验证；
5. 不编造标题、数字、引语、来源和 URL；
6. 来源冲突时明确展示差异；
7. 优先选择信息增量大、与用户偏好相关的新闻；
8. 同一事件的多篇转载只保留一个条目，可在条目中列出多个来源；
9. 最终必须调用 `save_brief`，不能只在对话中返回内容；
10. 达到用户设定篇数且信息已充分验证后停止调用工具。

### 6.3 Agent 运行方式

- 每次简报生成创建独立 Agent Session；
- Agent 对话状态可使用内存 Session；
- 业务历史由 SQLite 保存，不依赖 Pi 的会话文件作为产品数据库；
- 前端通过 SSE 订阅本次运行的工具调用和文本输出；
- 每次运行设置最大时长、最大 LLM Turn 数和最大工具调用数；
- 达到预算时停止搜索，并用现有可靠材料生成简报。

建议的 MVP 限制：

| 限制 | 默认值 |
|---|---:|
| 单次总运行时间 | 180 秒 |
| Agent Turn | 12 |
| 工具调用总数 | 30 |
| 单次搜索结果 | 10 条 |
| 单篇正文送入模型 | 12,000 字符 |
| 最终简报条目 | 5 条 |

## 7. 工具设计

### 7.1 题目要求的基础工具

为严格符合题目给出的名字和签名，建议实现 5 个自定义包装工具，而不是只在界面上给 Pi 内置工具改名。

#### `list_dir(path)`

- 功能：列出指定目录中的文件；
- 路径必须位于当前用户工作目录；
- 返回名称、类型、大小和更新时间；
- 限制最大返回条目数。

#### `read_file(path)`

- 功能：读取 UTF-8 文本文件；
- 路径必须位于当前用户工作目录；
- 支持最大字符数和截断提示；
- 不允许读取凭证、环境变量文件及项目外文件。

#### `search_content(keyword, dir)`

- 功能：在目录内按关键词搜索文本文件；
- 底层可使用 `ripgrep`，也可使用 Node.js 实现；
- 返回文件、行号和有限上下文；
- 限制文件类型、结果数量和执行时间。

#### `write_file(path, content)`

- 功能：将内容写入用户工作目录；
- MVP 仅允许写入 `.md`、`.json` 和 `.txt`；
- 自动创建必要的子目录；
- 使用临时文件加原子替换，避免部分写入；
- 在 Tool Result 中返回实际路径和字节数。

#### `bash(command)`

- 功能：执行受控命令；
- 固定工作目录为当前用户工作目录；
- 设置超时和输出上限；
- MVP 使用命令白名单；
- 禁止网络凭证读取、系统配置修改、递归删除和后台常驻进程。

> 在 Windows 开发环境中，内部实现可调用 PowerShell，但暴露给 Agent 的工具名仍保持为 `bash`，以满足题目接口要求。

### 7.2 新闻领域工具

#### `get_user_preferences`

输入：

```ts
{ userId: string }
```

输出：用户话题、关键词、排除词、语言、时间范围、篇数、时区和来源偏好。

#### `search_news`

输入：

```ts
{
  query: string;
  from?: string;
  to?: string;
  language?: string;
  sourceIds?: string[];
  limit?: number;
}
```

输出：结构化候选文章列表，不返回大段网页正文。

```ts
interface NewsSearchResult {
  articleId: string;
  title: string;
  sourceName: string;
  publishedAt: string;
  eventTime?: string;
  summary?: string;
  canonicalUrl: string;
  retrievedAt: string;
}
```

#### `fetch_article`

输入：

```ts
{ articleId: string }
```

输出：文章元数据、清洗正文、抓取时间和截断状态。

只接受由 `search_news` 返回并登记过的 `articleId`，避免模型请求任意 URL。

#### `find_related_articles`

输入：

```ts
{ articleId: string; limit?: number }
```

输出：同一事件或高度相关事件的其他来源，用于交叉验证。

#### `save_brief`

输入：结构化简报，而不是 Markdown 字符串。

```ts
interface SaveBriefInput {
  userId: string;
  runId: string;
  title: string;
  overview: string;
  items: Array<{
    headline: string;
    summary: string;
    whyItMatters: string;
    topic: string;
    sourceArticleIds: string[];
  }>;
}
```

工具负责：

- 校验引用的文章 ID 是否真实存在；
- 将结构化数据写入 SQLite；
- 渲染 Markdown 文件；
- 返回 brief ID 和文件路径；
- 防止同一个 `runId` 重复保存。

### 7.3 工具实现规则

- 参数全部使用 TypeBox Schema；
- 工具失败时抛出异常，不把错误伪装成成功文本；
- 所有网络和进程工具支持 `AbortSignal`；
- Tool Result 的 `content` 提供给模型，`details` 保存结构化审计信息；
- 工具输出设置大小上限；
- 搜索和阅读工具可并行；
- 写文件、保存简报等工具强制顺序执行；
- 使用 `beforeToolCall` 做路径、预算和权限检查；
- 使用 `afterToolCall` 记录耗时、结果数量和错误。

## 8. 新闻数据管道

### 8.1 Provider 接口

```ts
interface NewsProvider {
  id: string;
  search(
    request: NewsSearchRequest,
    signal?: AbortSignal,
  ): Promise<NewsSearchResult[]>;

  fetch(
    article: NewsSearchResult,
    signal?: AbortSignal,
  ): Promise<FetchedArticle>;
}
```

MVP 首先实现：

1. RSS Provider：无 API Key，可稳定演示；
2. 一个可配置的 Search Provider：用于关键词动态搜索；
3. Mock Provider：用于自动化测试，不访问外网。

### 8.2 标准化

不同来源统一转换为以下字段：

- 标题；
- 来源名称和来源 ID；
- 原始 URL 和 canonical URL；
- 发布时间；
- 作者；
- 摘要；
- 正文；
- 语言；
- 抓取时间；
- 内容哈希。

### 8.3 去重

按以下顺序处理：

1. canonical URL 完全相同；
2. 正文内容哈希相同；
3. 标题标准化后高度相似；
4. 标题与摘要的语义相似度超过阈值。

MVP 至少实现前三项。语义聚类可以放到第二阶段。

## 9. 数据模型

### 9.1 `users`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text PK | 用户 ID |
| display_name | text | 昵称 |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

### 9.2 `subscriptions`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text PK | 订阅 ID |
| user_id | text FK | 用户 ID |
| topics_json | text | 关注话题 |
| keywords_json | text | 关键词 |
| excluded_keywords_json | text | 排除词 |
| languages_json | text | 新闻语言 |
| source_ids_json | text | 指定来源 |
| max_items | integer | 简报条目数 |
| schedule_cron | text | 调度表达式，仅内部使用 |
| timezone | text | IANA 时区 |
| delivery_channel | text | `web`、`email` 等 |
| enabled | integer | 是否启用 |

### 9.3 `articles`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text PK | 文章 ID |
| provider | text | 数据提供方 |
| source_name | text | 新闻来源 |
| title | text | 标题 |
| canonical_url | text unique | 规范 URL |
| author | text nullable | 作者 |
| language | text | 语言 |
| published_at | text | 发布时间 |
| event_time | text nullable | 事件时间 |
| summary | text nullable | 来源摘要 |
| content | text nullable | 清洗正文 |
| content_hash | text nullable | 正文哈希 |
| retrieved_at | text | 抓取时间 |

### 9.4 `agent_runs`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text PK | 运行 ID |
| user_id | text FK | 用户 ID |
| trigger | text | `manual` / `scheduled` |
| status | text | queued/running/succeeded/failed/cancelled |
| started_at | text nullable | 开始时间 |
| finished_at | text nullable | 结束时间 |
| model | text | 模型标识 |
| tool_call_count | integer | 工具调用次数 |
| error_message | text nullable | 脱敏错误信息 |

### 9.5 `briefs` 与 `brief_items`

`briefs` 保存简报标题、总览、用户、日期、Markdown 路径和生成时间。  
`brief_items` 保存每条新闻的标题、摘要、价值说明、主题、排名。  
使用关联表 `brief_item_sources` 保存条目与原始文章的多对多关系。

## 10. API 设计

### 10.1 用户与偏好

```text
POST   /api/users
GET    /api/users/:userId
PUT    /api/users/:userId/subscription
GET    /api/users/:userId/subscription
```

### 10.2 Agent 运行

```text
POST   /api/users/:userId/runs
GET    /api/runs/:runId
POST   /api/runs/:runId/cancel
GET    /api/runs/:runId/events
```

`GET /events` 使用 SSE，事件类型至少包含：

- `run_started`；
- `agent_text_delta`；
- `tool_started`；
- `tool_finished`；
- `brief_saved`；
- `run_failed`；
- `run_finished`。

发送给前端的工具事件必须脱敏，不展示完整正文、API Key 或危险命令细节。

### 10.3 简报

```text
GET    /api/users/:userId/briefs
GET    /api/briefs/:briefId
GET    /api/briefs/:briefId/markdown
```

## 11. 前端页面

### 11.1 用户设置页

- 昵称；
- 关注话题；
- 包含关键词；
- 排除关键词；
- 语言；
- 简报条目数；
- 推送时间；
- 时区；
- 是否启用每日推送；
- “立即生成”按钮。

### 11.2 运行详情页

- 当前状态；
- Agent 实时输出；
- 工具调用时间线；
- 已搜索和已阅读的文章数量；
- 取消按钮；
- 成功后跳转到简报详情。

### 11.3 历史简报页

- 按日期倒序显示；
- 展示主题、来源和生成状态；
- 支持打开详情；
- 支持查看原始新闻链接。

UI 以清晰可用为目标，不投入复杂视觉设计。

## 12. 调度与推送

### 12.1 MVP 调度策略

- 单个 Scheduler 每分钟扫描一次启用的订阅；
- 根据用户时区判断是否到达推送时间；
- 使用“用户 + 本地日期”作为幂等键；
- 已存在 queued/running/succeeded 任务时不重复创建；
- 进程重启后可继续发现未执行任务。

### 12.2 推送渠道

MVP 默认使用站内 Web Inbox，即生成完成后可以在历史简报页查看。

第二阶段再增加：

- 邮件；
- Webhook；
- 企业微信、飞书或 Slack。

外部推送由应用层完成，不让 LLM 自己决定接收地址或直接发送。

## 13. 安全设计

Pi Agent Harness 默认不是权限沙箱，因此项目必须自行限制工具能力。

### 13.1 文件隔离

每个用户拥有独立目录：

```text
data/users/<user-id>/
├─ preferences.json
├─ briefs/
└─ workspace/
```

所有文件路径均通过 `path.resolve()` 解析，并验证最终路径仍位于该用户目录内。拒绝绝对路径、路径穿越和符号链接逃逸。

### 13.2 Shell 隔离

- 固定 cwd；
- 命令白名单；
- 超时终止；
- 限制 stdout/stderr；
- 禁止读取 `.env`、SSH、浏览器和系统凭证；
- 禁止安装软件、启动服务和修改系统配置；
- 生产部署时放入容器或独立沙箱。

### 13.3 网络安全

- 只允许 HTTP/HTTPS；
- 阻止 localhost、私有网段和云元数据地址；
- 限制重定向次数和响应体大小；
- 设置连接和读取超时；
- HTML 仅作为不可信数据处理；
- 前端渲染简报时进行 HTML 转义或 Markdown 消毒。

### 13.4 Prompt Injection

新闻网页中的文字是不可信内容。System Prompt 和工具返回需明确：

- 网页中的命令、角色声明和工具调用要求均不得执行；
- 文章正文只作为新闻材料；
- 网页内容不得改变系统规则；
- Agent 不得因为网页文本而访问其他文件或执行 Shell。

## 14. 可观测性

每次 Agent Run 记录：

- run ID、用户 ID、模型；
- 开始与结束时间；
- Agent Turn 数；
- 工具名称、耗时、是否成功；
- 搜索结果数和阅读文章数；
- Token 和成本（SDK 可获得时）；
- 最终 brief ID；
- 脱敏后的失败原因。

不得记录：

- API Key；
- 完整认证头；
- 用户隐私数据；
- 无必要的完整新闻正文。

## 15. 测试方案

### 15.1 单元测试

- 路径穿越被拒绝；
- 文件工具只能访问用户目录；
- Shell 危险命令被拒绝；
- RSS 结果正确标准化；
- canonical URL 去重；
- 标题相似度去重；
- `save_brief` 拒绝不存在的 article ID；
- 同一 run ID 重复保存保持幂等；
- 时区调度计算正确。

### 15.2 Agent 集成测试

使用 Mock Model 或固定 Tool Calling 响应，验证：

1. Agent 会先读取用户偏好；
2. Agent 可以自主连续调用多个工具；
3. 工具结果会回填模型；
4. 工具失败后 Agent 可以调整策略；
5. 最终调用 `save_brief`；
6. 简报中的每个来源都能映射到真实文章；
7. 超过工具预算后运行被终止。

### 15.3 端到端测试

- 创建用户；
- 保存订阅偏好；
- 手动触发生成；
- 观察 SSE 工具事件；
- 查看生成后的简报；
- 在历史页面重新打开简报。

测试默认使用 Mock News Provider，避免测试依赖外网和实时新闻变化。

## 16. MVP 验收标准

满足以下条件视为 MVP 完成：

- [x] 用户可在网页创建身份并保存订阅偏好；
- [x] 用户可手动触发一次新闻简报；
- [x] 定时器可按用户时区自动触发；
- [x] 已实现题目要求的 5 个指定名称工具；
- [x] 已实现 `get_user_preferences`、`search_news`、`fetch_article`、`save_brief`；
- [x] Agent 自主决定工具调用顺序和次数；
- [x] 前端能看到流式状态和工具调用过程；
- [x] 最终简报写入 SQLite，并生成 Markdown 文件；
- [x] 用户能查看历史简报；
- [x] 每条新闻至少包含标题、摘要、来源、发布时间和原始链接；
- [x] 文件工具无法访问用户工作目录之外；
- [x] Shell 工具有超时、输出上限和危险命令拦截；
- [x] 核心单元测试和端到端主流程通过。

## 17. 分阶段开发计划

### Phase 1：项目骨架

- 初始化 npm workspace、TypeScript、Vitest；
- 接入 Fastify 和 SQLite；
- 创建数据库 Schema 和迁移；
- 实现用户与订阅 CRUD；
- 建立最小 React 页面。

### Phase 2：基础工具与安全边界

- 实现 5 个题目指定工具；
- 建立用户工作目录；
- 实现路径隔离、超时和日志；
- 完成工具单元测试。

### Phase 3：新闻能力

- 实现 RSS Provider 和 Mock Provider；
- 实现新闻标准化、正文抽取和基础去重；
- 实现 4 个新闻领域工具；
- 建立文章缓存。

### Phase 4：Pi Agent

- 创建 NewsAgentService；
- 编写 System Prompt；
- 注册自定义工具；
- 接入 Agent 事件流；
- 实现运行预算、取消和错误状态；
- 完成 Mock Model 集成测试。

### Phase 5：端到端体验

- 实现手动生成；
- 实现运行详情和 SSE；
- 实现简报详情与历史列表；
- 实现定时调度；
- 完成端到端测试。

### Phase 6：质量增强

- 增加真实 Search Provider；
- 增强来源交叉验证和事件聚类；
- 增加邮件或 Webhook 推送；
- 增加成本、性能和质量评估。

## 18. 开发进度表

### 18.1 状态说明

| 标记 | 状态 | 含义 |
|---|---|---|
| ⬜ | 未开始 | 尚未进入开发 |
| 🟦 | 进行中 | 已开始，尚未满足验收条件 |
| 🟨 | 待验证 | 已实现，等待测试或评审 |
| ✅ | 已完成 | 已实现并通过对应验收 |
| ⛔ | 阻塞 | 存在依赖、权限或技术问题 |

更新规则：

- 每开始一个任务，将状态从“未开始”改为“进行中”；
- 代码完成但尚未验证时标记为“待验证”；
- 只有满足该行验收条件后才能标记为“已完成”；
- 阻塞时在备注中记录原因及下一步动作；
- 每完成一个阶段，同步更新“总体进度”和“最后更新日期”。

### 18.2 总体进度

| 阶段 | 状态 | 进度 | 目标产物 | 预计工期 | 实际完成日期 |
|---|---|---:|---|---:|---|
| Phase 1：项目骨架 | ✅ 已完成 | 100% | 可启动的 API、Web 和数据库 | 2 天 | 2026-09-17 |
| Phase 2：基础工具与安全边界 | ✅ 已完成 | 100% | 5 个基础工具及安全测试 | 2 天 | 2026-09-17 |
| Phase 3：新闻能力 | ✅ 已完成 | 100% | 新闻 Provider、抽取、去重和领域工具 | 3 天 | 2026-09-17 |
| Phase 4：Pi Agent | ✅ 已完成 | 100% | 可自主调用工具的 News Agent | 3 天 | 2026-09-18 |
| Phase 5：端到端体验 | ✅ 已完成 | 100% | 可操作的完整 MVP | 3 天 | 2026-09-18 |
| Phase 6：质量增强 | ✅ 已完成 | 100% | 搜索、聚类、推送和质量评估增强 | 按需 | 2026-09-18 |

总体状态：✅ Phase 1～6 全部完成，增强版本可交付  
总体进度：100%  
最后更新日期：2026-09-18

### 18.3 任务明细

| ID | 阶段 | 任务 | 状态 | 负责人 | 预计时间 | 实际时间 | 依赖 | 产物或验收条件 | 备注 |
|---|---|---|---|---|---:|---:|---|---|---|
| P1-01 | Phase 1 | 初始化 npm workspace、TypeScript、Lint 和 Vitest | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | 无 | 安装、构建、检查、测试命令可运行 | 已锁定依赖并生成 package-lock.json |
| P1-02 | Phase 1 | 创建 API、Web、packages 目录骨架 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P1-01 | API 与 Web 均可本地启动 | API 3000、Web 5173 实际启动验证通过 |
| P1-03 | Phase 1 | 接入 SQLite 与 Drizzle ORM | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P1-01 | 数据库迁移可重复执行 | 完整 Schema、首个迁移及幂等测试通过 |
| P1-04 | Phase 1 | 实现用户与订阅数据模型及 CRUD | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P1-03 | API 测试覆盖创建、读取和更新 | 创建/读取用户、创建/更新订阅及非法输入测试通过 |
| P2-01 | Phase 2 | 实现用户工作目录和路径安全模块 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P1-02 | 路径穿越和目录逃逸测试通过 | 用户 ID、绝对路径、敏感文件、遍历和符号链接逃逸均受限 |
| P2-02 | Phase 2 | 实现 `list_dir` 与 `read_file` | ✅ 已完成 | Codex | 0.25 天 | 未单独计时 | P2-01 | 正常读取、截断和越权测试通过 | 限制 200 个目录项、1 MB 文件和 12,000 返回字符 |
| P2-03 | Phase 2 | 实现 `search_content` | ✅ 已完成 | Codex | 0.25 天 | 未单独计时 | P2-01 | 可返回文件、行号和有限上下文 | 支持 md/json/txt，限制文件数、大小和结果数 |
| P2-04 | Phase 2 | 实现 `write_file` | ✅ 已完成 | Codex | 0.25 天 | 未单独计时 | P2-01 | 类型限制与原子写入测试通过 | 仅允许 md/json/txt，临时文件加原子替换 |
| P2-05 | Phase 2 | 实现受控 `bash` | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P2-01 | 白名单、超时、输出上限测试通过 | 禁止 Shell 操作符；进程不继承应用密钥环境变量 |
| P2-06 | Phase 2 | 为 5 个基础工具补齐 TypeBox Schema 和日志 | ✅ 已完成 | Codex | 0.25 天 | 未单独计时 | P2-02～P2-05 | 工具接口满足题目签名 | 统一 Tool Result、开始/成功/失败审计和 AbortSignal |
| P3-01 | Phase 3 | 定义 NewsProvider 接口与 Mock Provider | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P1-01 | 测试可在无网络环境运行 | Provider 接口、Mock Provider 和 NewsService 已完成 |
| P3-02 | Phase 3 | 实现 RSS Provider | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P3-01 | 可解析至少 3 个配置 Feed | 三 Feed 离线解析测试通过，单源失败可降级 |
| P3-03 | Phase 3 | 实现新闻标准化和缓存 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P3-01、P1-03 | 文章可以稳定写入和读取数据库 | ArticleRepository、正文缓存及增量迁移已完成 |
| P3-04 | Phase 3 | 实现正文抽取 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P3-03 | 抽取失败可降级为来源摘要 | Readability + JSDOM，限制正文长度并支持摘要回退 |
| P3-05 | Phase 3 | 实现 URL、哈希和标题去重 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P3-03 | 重复测试集达到预期结果 | 规范 URL、SHA-256、标题 Jaccard 相似度和关联搜索 |
| P3-06 | Phase 3 | 实现新闻领域工具 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P3-02～P3-05 | 偏好、搜索、正文、关联和保存工具测试通过 | 5 个领域工具均已实现并通过集成测试 |
| P4-01 | Phase 4 | 锁定并接入 Pi Coding Agent SDK | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P1-01 | 最小 Agent 可以完成一次对话 | 锁定 0.85.1，使用高层 createAgentSession 与官方 Faux Provider 验证 |
| P4-02 | Phase 4 | 编写并测试 System Prompt | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P4-01、P3-06 | 不依赖记忆回答实时新闻 | 强制工具核验、来源引用、网页不可信和 save_brief 收口 |
| P4-03 | Phase 4 | 创建 NewsAgentService 并注册工具 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P2-06、P3-06、P4-01 | Agent 可自主连续调用多个工具 | 仅注册安全自定义工具，内置工具全部关闭 |
| P4-04 | Phase 4 | 实现事件映射和运行日志 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P4-03 | 工具和文本事件可被 API 消费 | 7 类应用事件已实现，参数、正文和凭证不向事件暴露 |
| P4-05 | Phase 4 | 实现时间、Turn 和工具调用预算 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P4-03 | 超限运行能安全停止 | 默认 180 秒、12 Turn、30 工具调用，支持主动取消和状态落库 |
| P4-06 | Phase 4 | 实现 Agent 集成测试 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P4-02～P4-05 | Mock Model 主流程与失败流程通过 | Faux Model 覆盖多工具、失败恢复、保存、预算与取消；全仓库 30 项测试通过 |
| P5-01 | Phase 5 | 实现运行创建、查询、取消 API | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P4-03、P1-04 | 运行状态转换正确 | 异步启动立即返回 run ID，支持查询和取消 |
| P5-02 | Phase 5 | 实现 SSE 实时事件接口 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P4-04、P5-01 | 页面可实时看到工具调用和输出 | 支持最多 200 条内存回放并在终态关闭连接 |
| P5-03 | Phase 5 | 实现设置页 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P1-04 | 可编辑并保存完整偏好 | 话题、关键词、排除词、语言、来源、数量、时区和 Cron 均可编辑 |
| P5-04 | Phase 5 | 实现运行详情页 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P5-02 | 展示状态、事件和取消操作 | 实时文本与工具时间线、运行状态和取消按钮已完成 |
| P5-05 | Phase 5 | 实现简报详情与历史页 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P3-06 | 可查看简报和原始来源 | 支持历史、结构化详情、来源链接和 Markdown |
| P5-06 | Phase 5 | 实现时区调度与幂等控制 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P5-01 | 同一用户同一天不会重复执行 | 每分钟扫描，按 IANA 时区匹配，数据库唯一幂等键防重复 |
| P5-07 | Phase 5 | 完成端到端测试与演示数据 | ✅ 已完成 | Codex | 0.5 天 | 未单独计时 | P5-01～P5-06 | MVP 验收主流程全部通过 | Faux Model + Mock News 完整离线演示；全仓库 32 项测试通过 |
| P6-01 | Phase 6 | 接入真实 Search Provider | ✅ 已完成 | Codex | 1 天 | 未单独计时 | P3-01 | 支持动态关键词和时间查询 | Tavily 新闻搜索、时间/语言过滤、正文抽取与摘要降级；真实 API 连通验证通过 |
| P6-02 | Phase 6 | 增加语义聚类和来源交叉验证 | ✅ 已完成 | Codex | 1 天 | 未单独计时 | P3-05 | 同事件聚类质量达到测试基线 | 基于标题和摘要的语义相似度聚类，统计独立来源并标记交叉验证状态 |
| P6-03 | Phase 6 | 增加邮件或 Webhook 推送 | ✅ 已完成 | Codex | 1 天 | 未单独计时 | P5-06 | 推送失败可重试且不重复 | 实现 HTTPS Webhook，最多重试 3 次，数据库记录状态并保证成功推送幂等 |
| P6-04 | Phase 6 | 增加质量、成本和性能评估 | ✅ 已完成 | Codex | 1 天 | 未单独计时 | P4-06 | 可输出固定评测集报告 | 持久化 Turn、耗时、Token 和成本，提供单次运行评估 API；全仓库 35 项测试通过 |

### 18.4 里程碑

| 里程碑 | 对应任务 | 完成标准 | 目标状态 |
|---|---|---|---|
| M1：基础应用可运行 | P1-01～P1-04 | API、Web、数据库和偏好 CRUD 可运行 | ✅ 已完成 |
| M2：基础工具可演示 | P2-01～P2-06 | 5 个指定工具均可被安全调用 | ✅ 已完成 |
| M3：新闻数据可用 | P3-01～P3-06 | 可搜索、读取、去重并保存新闻 | ✅ 已完成 |
| M4：Agent 自主闭环 | P4-01～P4-06 | Agent 能自主生成并保存带来源简报 | ✅ 已完成 |
| M5：MVP 可交付 | P5-01～P5-07 | 用户可配置、触发、观察和查看历史 | ✅ 已完成 |
| M6：增强版本 | P6-01～P6-04 | 搜索、聚类、推送和评估能力完善 | ✅ 已完成 |

## 19. 关键风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| Pi SDK API 版本变化 | 编译失败 | 锁定版本与 lockfile，封装适配层 |
| 新闻 API 不稳定 | 无法生成 | RSS + 搜索 Provider 组合，提供缓存 |
| 网页反爬或抽取失败 | 正文缺失 | 保留来源摘要，允许 Agent 跳过 |
| 新闻内容 Prompt Injection | 越权工具调用 | 明确信任边界，限制工具与网络 |
| Shell 工具权限过大 | 系统风险 | 白名单、隔离目录、容器化 |
| LLM 无限搜索 | 成本和延迟失控 | Turn、工具次数、时间和 Token 预算 |
| 引用幻觉 | 可信度下降 | 使用 article ID，保存时后端校验 |
| 重复推送 | 用户体验差 | 用户 + 日期幂等键 |

## 20. 开发决策记录

### ADR-001：选择 Pi Coding Agent SDK

决定：使用高层 SDK，而不是自行实现完整 Agent Loop。  
原因：项目重点是新闻垂类能力，不是重复开发会话、Tool Calling 和重试机制。

### ADR-002：业务历史独立存储

决定：简报、文章和运行记录保存在 SQLite。  
原因：Pi Session 是 Agent 上下文，不应代替产品数据库。

### ADR-003：基础工具使用安全包装

决定：实现与题目签名一致的自定义工具。  
原因：可以严格满足命名要求，并限制文件与 Shell 权限。

### ADR-004：Agent 保存结构化简报

决定：`save_brief` 接收结构化字段，Markdown 由应用层渲染。  
原因：便于校验引用、查询历史、更换 UI 和输出格式。

## 21. 参考资料

- Pi Agent Harness：<https://github.com/earendil-works/pi>
- Pi Agent Core：<https://github.com/earendil-works/pi/blob/main/packages/agent/README.md>
- Pi Coding Agent SDK：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md>
