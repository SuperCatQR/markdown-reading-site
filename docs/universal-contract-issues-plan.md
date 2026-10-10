# 新增通用契约 Issues 评估

2026-10-10 本轮 #57、#59–#63 修复执行期间，02:39–02:43 UTC 新增 #64–#68；收尾于 03:12 UTC 刷新发现。本文件评估新增工作，不表示已实施，也不能把本轮六项修复当作这些迁移问题已解决。两份当前生产输入仍为 v2，公开 0 篇、草稿 583 篇，内容未改动。

依据项目哲学的准确冻结事实、连续阅读、再次访问和独立静态前端边界，新增问题属于一次相互依赖的消费契约迁移。它不能通过放开版本检查、添加 BVID 别名或只改 JSON 版本号实现。

| Issue | 判断 | 优先级与依赖 | 修复边界 |
| --- | --- | --- | --- |
| #64 | 当前校验只接受 v2，新 universal-v3 导出被拒绝；问题成立。 | P0，先固定 producer #294 严格新导出规则。 | catalog v3、content v2、source metadata v1；准确字段、来源 URL、时间、文件及哈希；拒绝 legacy 和混合条目；明确无损数值或双方安全整数子集。 |
| #65 | 分组、路由和局部索引直接依赖 bvid/pageIndex，仅放开校验会串来源。 | P0，依赖 #64。 | 集中纯来源身份模块，以 `(platform, externalVideoId)` 分组、partIndex 排序；显式平台路由；资产路径使用受控编码或摘要，旧视频路由不自动转换。 |
| #66 | 当前进度记录依赖旧来源字段，新条目无法准确写入。 | P1，依赖 #64/#65。 | 新独立 storage key/envelope，绑定完整来源 tuple 与版本；旧记录不读取、不迁移、不自动删除；保留到期、数量、跨 tab、tombstone 与失败反馈。 |
| #67 | 当前来源展示与主题使用旧字段，新条目可能显示 undefined/NaN，编辑 tags 与来源 tags 混称。 | P1，依赖来源模块。 | 来源 metadata 与稿件编辑字段明确分离；主题使用冻结来源 tags；作者、来源时间、稿件时间及观察时间准确表达，未知保留未知；手机安全文本不溢出。 |
| #68 | 仅提交新代码会使现有 v2 快照无法构建；整体交付风险成立。 | P0，完成前置后验收。 | 真实 producer 闭环 fixture、两平台、空 v3、公开 A/草稿 B、审核/撤回、安全与拒旧测试；代码、测试、文档与两份完整新快照同一可构建分支交付。 |

执行顺序为 producer #294 严格导出与真实新稿范围确认 → #64 校验及固定 fixture → #65 来源模块与所有调用点 → #66/#67 并行 → #68 双快照及整份 artifact 验收。可在本轮阅读修复分支基础上建立后续独立分支；本轮搜索候选与系列契约须随新身份继续整合，不能留两套来源模型。

生产切换前必须列出旧 583 篇中需要真实再生成的范围、缺失 metadata、导出计数变化及新审核/发布依据。不得静默过滤旧稿、伪造 metadata、修改冻结哈希或自动批准历史内容。两份导出命令不天然原子；若期间发布状态变化，应重新成对导出及验证。

验证包括 bilibili/YouTube、同外部 ID 不同平台、大小写身份、未知时间、长多语言来源、五种审核状态、安全 cover、非安全数值、公开/草稿隔离与撤回。保留与新契约有关的全部安全和阅读回归，删除仅以“旧格式仍接受”为目标的断言。最终执行 test/validate/Pages 子路径 build 和手机/桌面完整浏览器流程；部署与回退以整份代码、双快照、静态产物为单位。

本轮尚未修改 universal-v3 校验、平台身份或生产双快照，未执行这些新 issues 的数据再生成、审核、发布或部署。详细需求以 GitHub [#64](https://github.com/SuperCatQR/markdown-reading-site/issues/64)、[#65](https://github.com/SuperCatQR/markdown-reading-site/issues/65)、[#66](https://github.com/SuperCatQR/markdown-reading-site/issues/66)、[#67](https://github.com/SuperCatQR/markdown-reading-site/issues/67)、[#68](https://github.com/SuperCatQR/markdown-reading-site/issues/68) 及 [producer #294](https://github.com/SuperCatQR/bilibili-asr-archive/issues/294) 为准。
