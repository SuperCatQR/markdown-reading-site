# Markdown 阅读稿站历史架构

这份图固定描述 `cbf5a8706955a3301523abf36bc34d5250b2d620` 的旧阅读稿实现，
用于保存既有 UI 与部署结构的历史证据。当前站点已经改为严格 publication 快照，
当前数据流以 [README 架构](../README.md#架构) 为准。

这份目录保存项目架构图的长期维护源文件与生成产物：

- [可交互架构图](./markdown-reading-site-architecture.html)：自包含 HTML，可直接在浏览器打开，支持图例、视图切换和源码定位。
- [Archify 规格](./architecture.json)：唯一需要手工编辑的图源。节点、关系、边界和源码证据都在这里维护。

## 历史覆盖范围

图覆盖完整的运行闭环：主项目的 SQLite 阅读稿源、`bili-asr reading-export` 只读导入、`content/` 发布快照、清单校验、Vite 构建、GitHub Pages 部署、浏览器端目录与阅读页、Markdown 安全渲染，以及 GitHub Issue 驱动的人工审核和重新导入。

仓库证据固定在 `cbf5a8706955a3301523abf36bc34d5250b2d620`。这使图中的源码链接对应一个明确版本；当代码变更后，应同时更新规格中的 `meta.repository.revision` 和受影响节点的 `sources`。

## 重新生成

在仓库根目录执行：

```powershell
node C:\Users\ChosenEcho\.agents\skills\archify\bin\archify.mjs finalize architecture docs/architecture.json docs/markdown-reading-site-architecture.html --repo-root . --quality showcase --json
```

`finalize` 会依次执行 schema / 语义校验、HTML 交付、严格产物检查和真实浏览器检查。非零退出码表示图需要先修复；不要把失败的 HTML 当作已验证产物提交。

## 更新规则

1. 先从入口、配置、调用点和部署工作流确认新事实，再改 `docs/architecture.json`。
2. 每个仓库内节点保留不超过三个最有解释力的源码引用；关系的标签只描述源码能证明的动作、方向、协议或条件。
3. 生成后检查 `docs/markdown-reading-site-architecture.finalize-summary.json` 的校验与浏览器结果，并在代码评审中一起提交 JSON、HTML 和本说明的变更。
4. 发生节点职责、数据来源、部署方式或审核流程变化时，更新对应视图的 `focus` 与维护卡片，避免只改标题而留下过期关系。

## 重要边界

历史版本会把待审正文、审核稿、来源链接和质量状态放入公开文件。
当前版本只接受准确版本获批并显式发布的有效 release，禁止内部审核包、草稿状态和旧数组目录。
站点始终是公开静态站点，没有访问控制或后台 webhook；历史图不描述当前主项目的发布实现。
