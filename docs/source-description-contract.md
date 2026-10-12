# 来源简介契约与阅读展示

该改动服务核验来源的读者和导入快照的维护者：上游补齐视频简介后，阅读站能接受对应
快照，并在“更多 → 来源与版本”展示简介和来源证据。来源简介与编辑摘要分别标注，
不会用简介替换摘要，也不从正文生成简介。它落实产品原则中的来源准确表达、
有依据的元数据和按需核验，不改变静态站点或生产审核边界。

## 当前架构

上游显式导出 → `validate-catalog.mjs` 扫描完整公开快照 → `catalog.js` 校验 manifest、
目录和原始文件 → `universal-contract.js` 校验 profile、来源身份和字段证据 →
`reader-content.js` 在受管输入以外生成派生资源 → 浏览器按需加载完整 entry →
`src/refactor/views.js::sourcePanel` 展示简介及准确版本。正文和参照仍使用原始 bytes，
简介不加入初始轻量目录，也不改变编辑摘要搜索的语义。

| profile | catalog | content | source metadata | origins | manifest |
| --- | --- | --- | --- | --- | --- |
| universal-origin-v1 | 3 | 2 | 1 | 1 | 2 |
| universal-origin-v2 | 3 | 2 | 1 | 2 | 3 |

每份快照独立绑定一组版本。origins 与 manifest 的 profile 必须相等，manifest
snapshotId 包含实际版本和 profile；拒绝未知 profile、混搭版本和简介证据降级。
部署的公开目录与未发布目录可以使用不同的有效 profile，仍禁止同一 edition
同时声明为已发布和未发布。

v2 继续接受原生 AI v2、冻结历史事实及既有分 P 标题补充。它额外接受
`legacy-description-supplement-v1`：补充 evidence.version=2、field=description、
sourceKind=archive-video-details-projection。补充 ID 使用证据 canonical JSON
SHA-256，来源平台、视频 ID、partIndex、videoPartId 与稿件绑定；cid 必须为正安全整数。
简介值必须与冻结 sourceMetadata.description 相等；文本最多 65536 个 Unicode
码点，保留换行与制表符，拒绝其余控制字符。

description 元数据证据必须使用相同的值哈希、sourceKind 和 observedAt。
采集时间允许为未知 null 或非负安全整数；metadataObservedAt 不替代字段采集时间。
其他历史未知字段继续为 null（tags 为 []），不能借简介补充写入未经观测的作者、
时间或分 P 标题。v1 的旧字段、观察时间和策略约束保持严格。

## 界面边界

简介作为转义后的普通文本显示，不渲染 HTML、Markdown 或自动链接。CSS pre-wrap
保留换行，长词随来源面板宽度换行。null 显示“未提供”，已观测的空字符串显示
“（空简介）”，不以摘要填充。编辑摘要保持独立行；证据披露按真实字段分别标为
“来源简介补充证据”或“分 P 标题补充证据”。

该消费者只接受生产者已注册的来源策略，不为原生文章回填或单篇多字段补充发明
新来源格式；这些上游范围须通过新的明确契约交付。代码能力不表示历史内容已回填、
审核或上线。

## 验证与复现

`node --test test/source-description.test.js` 覆盖真实生产者导出的发布简介与草稿标题
快照、派生 reader 资源保留证据、重签 manifest 后的语义篡改、版本混搭和降级、
未知采集时间与空简介、HTML/Markdown 转义及换行。生产者 fixture 的来源和
重生成入口见 `test/fixtures/source-description-v2/README.md`。

`pnpm test` 验证旧 v1 消费与阅读回归；`pnpm build` 在现有生产快照上验证完整构建。
真实 v2 fixture 用于独立临时站点的构建与浏览器检查；不替换 content/ 或
draft-content/ 中的受管输入。无部署或历史回填操作。

2026-10-12 验证：184 个 Node 测试通过；现有双快照校验和构建通过。首次完整构建
遇到既有 Windows esbuild 系统临时目录删除权限错误，指定工作区 TEMP/TMP 后成功，
未改依赖或跳过校验。独立 v2 fixture 构建通过；
`scripts/check-source-description-browser.js` 在 320、390、1440 像素 Chromium 通过
正文进入、来源工具切换、简介原文、pre-wrap、证据展开、编辑摘要独立行、
无水平溢出和无脚本错误检查。故意移除 observedAt 绑定使语义篡改测试失败，恢复后
简介测试全部通过。完整构建保留既有大 chunk 提示。
