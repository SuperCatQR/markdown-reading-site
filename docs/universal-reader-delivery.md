# #64–#68 通用契约修复交付

本次服务学习者的多平台查找与连续阅读、回访读者的正文恢复，以及查证者和维护者的来源核验。依据 [产品原则](product-philosophy.md)，冻结事实、审核状态及正式发布事实保持准确，前端继续独立静态运行。范围见 [Issues 评估与计划](universal-contract-issues-plan.md)。

## 契约与输入基线

分支 `codex/complete-universal-reader-issues` 基于 main `1a6da609d832e51847cd4b0b50a833f083525a94`（PR #75/#77/#78）。生产者契约固定于 [b584f6a / PR #304](https://github.com/SuperCatQR/bilibili-asr-archive/blob/b584f6ac29b9e6acf598496c255ee73753063074/docs/preserved-body-import.md)。早期 #64/#68 描述的 manifest v1 已被实际 `universal-origin-v1` 交付替代。

唯一消费契约为 catalog v3、content v2、source metadata v1、origins v1、manifest v2。拒绝旧 catalog/条目/manifest、旧无平台视频 URL 和旧进度消费，不转换、不猜字段。迁移正文由真实 v2 内容与 origin 绑定；保留历史 AI 基线不等于前端支持旧 catalog。

| 受管快照 | 篇数 | snapshotId |
| --- | --- | --- |
| content | 0 | `239cef0cd903de3bb1d7d0007b20426abb0dd1fbd9a260b27ea4dad5bc981cf7` |
| draft-content | 1,228 | `603ea703e9d9cfe715056700c9d2362d839698ba3656a7cad54fe089ff2385fd` |

全部生产稿为 Bilibili 未发布、待审核，涉及 1,024 个视频。1,103 篇保留迁移正文、125 篇原生 v2；与早期 583 篇盘点相比新增 645 篇。依据见 [生产导入记录](production-preserved-import-20261010.md)。本次不改受管输入和真实 fixture 的任何字节，不审核或发布稿件。YouTube 是已验证的读取能力，当前生产目录没有 YouTube 稿件。

## 当前架构与行为

`validate-catalog.mjs` 在开发与构建前校验成对目录；`catalog.js` 验证准确字段、原始 UTF-8/JSON 数值、文件集合/路径、manifest digest 及正文和参照 bytes；`universal-contract.js` 验证完整来源、metadata/origins 绑定与时间语义。raw 数字只接受十进制安全整数，避免 JavaScript 在解析时先舍入错误数值。

验证后的内容通过 `source-identity.js` 进入派生层。分组、缓存、候选索引和会话使用 `platform.externalVideoId`，保留大小写；partIndex 决定顺序。视频 URL 显式使用 platform 和 video，连续模式带类别及准确 edition。文章 slug/edition 定位继续有效，撤回或已替换的旧 edition 没有自动映射。

`reader-content.js` 在受管目录外生成搜索和摘要，视频资产使用来源键 SHA-256；开发与构建按同一逻辑键映射。局部搜索只加载当前视频与所选类别。Rollup 可合并逐字节相同的资产，例如只有一个视频的类别索引；浏览器验收核对实际响应的完整 edition 集合，不仅从文件名判断范围。series v1 仍为编辑确认的 Bilibili 系列，按新条目的 bilibili/externalVideoId 绑定，不能关联 YouTube。

主题统计、筛选、标签入口、元数据及候选搜索使用 sourceMetadata.tags，不回退稿件编辑 tags。来源面板区分稿件与来源原标题，显示创作者、视频发布时间与观察时间（UTC）；未知值保持未知，不由导入时间补齐。YouTube 标为单视频。迁移正文、迁移后编辑与原生来源保留真实说明；参照仍是对应 AI revision 的固定基线。

进度使用 reader-history-v2 / envelope v2，核对 contentVersion、平台、外部 ID、partIndex、类别、videoPartId、edition、内容及文件哈希，发布稿另核对 release。旧 key 保留原值，不读取、不迁移、不在初始化或清空新记录时自动删除。保留 20 篇、180 天、跨 tab 删除/清空保护、参照隔离、实际可见连续部分和临时工具跳转保护。

## 验收与复现

- `pnpm test`：116 项通过，保留并迁移原有安全、搜索、阅读、系列与本地状态场景；新增旧格式拒绝、raw 数值舍入、来源/编辑标签分离、完整身份变更、Unicode、时间与封面回归。
- `pnpm validate`：生产成对快照通过，0 篇已发布、1,228 篇未发布。
- `VITE_BASE_PATH=/markdown-reading-site/ pnpm build`：完整生产构建通过。Windows esbuild 对系统临时目录文件删除报 Access denied，使用工作区临时目录重跑成功；未改依赖或跳过校验。仍有大 chunk 提示。
- 真实 producer fixture 保持原字节：来源固定于 `test/fixtures/universal-origin-v1/README.md`。独立站以 published-example 为 content、原 draft-content 为草稿，完整校验及构建通过（1 篇公开、3 篇草稿）。生产 serving roots 全程不替换。
- `check-universal-reader-browser.js` 在独立站开发服务及构建产物运行：1440/390/320 像素、两平台、12 次稿件访问；正文、冻结来源、参照、局部搜索实际集合、YouTube 连续阅读、非法/旧 URL、旧 key 原值通过，无页面脚本错误。
- `check-reading-history-browser.js` 在生产子路径构建产物通过：精确段内及同页恢复、hash/history 优先、参照隔离、更新/撤回、删除/清空、当前连续部分、异步搜索恢复及用户滚动中断；quota/禁用/损坏/未知版本四类存储异常不阻止阅读或虚报保存。
- `check-tool-progress-browser.js` 在 390×844 的生产构建产物通过：待保存位置捕获、工具返回位置与焦点、查找/导览切换、迅速重开、结果展开/收起、主动正文滚动、结束查找及当前连续部分恢复保护。验收使用现有段落导览，不添加伪造章节。
- dist 的 2,456 个 Markdown 文件逐个匹配当前受管快照的 2,456 个正文/参照原始哈希；没有额外 Markdown 或数据库、锁、备份、journal、review.json 等私有文件。生产双快照和原 fixture 的 Git diff 均为空。
- 故意反转 catalog 版本校验，真实 fixture 测试失败；恢复后全套通过。`node scripts/check-search-candidate-mutations.mjs` 检出丢失 posting 和错误正文映射。

独立 fixture 站应复制 src、scripts、index.html、package.json 和 vite.config.js 到 serving roots 外的临时目录，再复制两份完整 fixture。可用 node 执行已安装的 Vite CLI，避免 pnpm 因临时目录的依赖链接尝试重新安装。浏览器脚本读取当前页面地址，在 fixture 开发或 preview 页执行即可。生产长文恢复与手机工具脚本使用当前冻结 edition，辅助脚本同步显式平台及新进度字段。

## 发布与回退门禁

本地构建和浏览器验证不等于生产部署。PR 检查运行测试及子路径构建；main 部署工作流在这些步骤成功后才能上传 dist，失败不上传 artifact。合并后记录部署 commit，核对 Pages artifact 与线上目录/正文/进度。#68 的生产切换验收在该事实成立后完成。

部署单位为同一提交的代码、完整双快照与完整 dist。原始稿件、manifest、origins、审核/发布事实不可临时补齐。暂存、备份、锁、journal、数据库及私有审核材料留在 serving roots 和 artifact 之外。回退上一完整提交和 artifact，不将新代码与旧格式快照混用。
