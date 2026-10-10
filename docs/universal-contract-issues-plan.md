# 通用契约 Issues 评估与修复计划

2026-10-10 的评估覆盖当时全部开放的 #64–#68。五项均成立，属于一次消费契约切换：#64/#65 提供校验与统一身份，#66/#67 提供准确恢复与来源表达，#68 验证完整交付。此前只评估和计划；收到“上游改好了，开始解决 #64–#68”后，在 `codex/complete-universal-reader-issues` 实施。

服务多平台内容的学习者、回访读者、查证者与维护者，改善查找、连续阅读、正文恢复和来源核验。依据 [项目哲学](product-philosophy.md)，保持冻结事实准确、审核与发布事实分开、独立静态前端及完整构建校验。

## 上游与输入已更新

早期 issues 的 manifest v1 和全部重新生成方案已被上游实际交付替代。采用 producer PR #304 的 `universal-origin-v1`：catalog v3、content v2、source metadata v1、origins v1、manifest v2。阅读站 PR #75 已接入新格式但仍有旧消费分支；PR #77 已交付两份完整新快照；PR #78 纠正已有 edition 与人工正文修改的区别。本次移除剩余兼容分支，不能改快照版本号或伪造来源。

当前输入是 0 篇已发布、1,228 篇未发布、1,024 个视频；全部草稿待审核。1,103 篇由上游验证保留旧正文，125 篇为原生 v2。16 个选择已有 edition 的条目正文仍与 AI 初稿相同，不能据此声称人工修改。详见 [生产迁移记录](production-preserved-import-20261010.md)。本次不改两份快照及 producer fixture 的原始字节。

## 修复对应关系

| Issue | 实施内容 | 验证与交付要求 |
| --- | --- | --- |
| [#64 严格契约](https://github.com/SuperCatQR/markdown-reading-site/issues/64) | 唯一 profile 和独立版本；准确字段、来源身份、时间、Unicode、封面、原始 JSON 安全整数；完整 manifest/origins/正文/参照验证 | 真实导出通过；旧格式、混合条目、额外字段、错误哈希和私有文件拒绝；版本校验变异必须被检出 |
| [#65 平台身份](https://github.com/SuperCatQR/markdown-reading-site/issues/65) | 平台与外部 ID 分组，partIndex 排序；显式 platform/video URL；路由、会话、连续阅读、搜索统一 videoKey；资产使用来源键摘要 | 平台及大小写隔离、类别缓存隔离、连续顺序、Bilibili 系列绑定、局部请求范围及开发/构建一致 |
| [#66 阅读进度](https://github.com/SuperCatQR/markdown-reading-site/issues/66) | reader-history-v2/envelope v2；核对完整来源、contentVersion、edition/content/artifact/release | 旧 key 不读取、不迁移、不自动删除；参照隔离、当前部分、工具跳转、损坏存储、多 tab、更新/撤回/删除回归 |
| [#67 来源展示](https://github.com/SuperCatQR/markdown-reading-site/issues/67) | 来源标签独立于编辑 tags；准确原标题、创作者、来源/观察时间；YouTube 单视频；真实迁移与原生说明 | 未知值保持未知；UTC、恶意/多语言文本、空来源标签、两平台桌面与手机检查 |
| [#68 整体交付](https://github.com/SuperCatQR/markdown-reading-site/issues/68) | 迁移旧格式测试和辅助脚本，保留安全及行为场景；双快照及真实 fixture 构建、浏览器回归、文档和交付记录 | PR 检查通过后部署同一提交；核验线上与完整 artifact。离线构建或 PR 创建不等于生产切换完成 |

实施和验收证据、当前架构及部署/回退范围统一记录在 [通用契约修复交付](universal-reader-delivery.md)。历史 architecture.md 保留当时证据，不作为当前契约说明。
