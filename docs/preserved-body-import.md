# 保留旧正文的迁移导入

此改动服务需要阅读、核验和继续阅读历史讲解稿的学习者，遵循项目哲学中来源准确、
审核与发布分开记录、按需加载正文及独立静态前端的原则。

新入口接受生产者显式导出的 `universal-origin-v1`：两份 catalog 均为 v3，
manifest 为 v2，受管文件包含 `catalog.json`、`origins.json` 和正文/参照配对。
每篇稿件必须是 content v2；不接受将 content v1 加几个字段作为通用稿件。
当前 reader 只接受上述 profile；catalog v2、manifest v1 和 legacy article 全部拒绝，两个目录均须使用完整新契约。

```powershell
bili-asr publication export-drafts --archive-root ARCHIVE_COPY --out NEW_DRAFTS --contract-profile universal-origin-v1 --edition-id IMPORTED_EDITION_ID
bili-asr publication export --archive-root ARCHIVE_COPY --out NEW_PUBLICATIONS --contract-profile universal-origin-v1 --empty-scope
```

`--empty-scope` 是有意为空的已发布快照，仅适合此次选择范围中没有正式发布稿的情况。
已有公开内容需要以准确 release ID 导出，或审核后显式发布新稿；不要将空快照当作
完整生产导出。两个输出目录验证通过后再作为一组替换站点输入目录。

来源记录严格区分三种情况：

- `ai-generated-v2`：原生 AI v2 基线。
- `preserved-legacy-body`：旧正文保持原样，迁移时未重新生成；参照保留 ai-draft-v1。
- `edited-after-preservation`：迁移后的正文已编辑；参照仍是历史 AI 基线。

页面正文和参照顶部明确显示迁移来源。来源详情保留准确输入/AI 模板、导入 ID 和
基线/当前正文哈希；导入不会变成审核或发布事实。未知源视频发布时间和采集时间
显示未知，不能用 edition 创建时间或导入时间补充。旧 input 能证明的只有标题与身份，
生产者冻结策略保留其它源事实为空，编辑标签与源标签仍是不同字段。

构建校验准确字段、UTF-8、无重复 JSON 字段、文件白名单、逐文件 SHA-256、
manifest v2 的 canonical snapshotId、来源唯一性与排序、版本/参照/元数据哈希绑定，
以及正文是否保留的哈希关系。即使重新签出 manifest，错误的来源语义也会被拒绝。
没有私有 prompt、内部审阅文件或路径进入公开快照。

平台身份直接使用 `platform`、`externalVideoId`、`partIndex`。阅读、分 P 导航、
视频内查找、全站候选索引和阅读进度都使用平台身份，不给 YouTube 或通用稿件制造
BVID。分组用的 `platform.externalVideoId` 只存在于派生索引与导航；catalog 字节不修改。
系列 v1 仍是编辑确认的 Bilibili 系列，不能自动推断跨平台关系。

## 验证

`test/fixtures/universal-origin-v1` 保存生产者直接导出的合成快照，包括三种来源、
空公开目录和明确审核发布的迁移稿。测试包含语义篡改、旧 manifest 降级、遗漏/重复
来源、错误参照、非法来源元数据、平台路由、分片搜索和阅读记录恢复。

PR #75 阶段的 583 篇旧快照验证属于历史证据；PR #77 已切换为 1,228 篇新快照。该阶段全站测试和生产构建通过；桌面 1440x1000 与手机 390x844
浏览器验证正文、参照、迁移后编辑、视频内查找、全站搜索及连续阅读。三个真实旧稿
在隔离数据库副本导入后可正常阅读，旧正文哈希相等，AI 与工作流计数保持不变。
这些验证不表示已经切换生产数据库、批准迁移稿或部署网站。
