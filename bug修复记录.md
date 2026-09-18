# 根目录 `.env` 未加载问题

## 现象

配置了 DeepSeek 和 Tavily Key，但生成结果仍是本地 Mock 简报。

## 原因

通过 npm workspace 启动 API 时，工作目录是 `apps/api`。原代码按相对路径读取 `.env`，因此查找的是 `apps/api/.env`，没有读取项目根目录的 `.env`，随后回退到 Demo Runtime。

## 修复

API 启动时根据 `server.ts` 的位置解析项目根目录，并显式加载根目录 `.env`。修复后重新启动 API 即可启用 DeepSeek + Tavily 真实运行时。
