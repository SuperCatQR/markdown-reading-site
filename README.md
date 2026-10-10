# Markdown 稿件阅读站

独立静态站点，展示主项目中正式发布的有效 release，以及明确标注审核状态的当前未发布编辑版本。
浏览器读取各自快照中的公开正文、AI 初稿的校验参照稿和读者元数据；SQLite、独立 AI 合成稿及内部事件留在主项目。

仓库初始保留两份合法空快照；本地联调使用的合成稿件不会作为正式内容提交。

## 产品定位与改动依据

项目面向长视频与系列讲解内容的学习者，提供可搜索、可连续阅读、可回看来源的文字资料库，服务阅读、查找、复习与核验。

后续功能、界面、内容组织和技术选型以 [项目哲学与产品原则](docs/product-philosophy.md) 为产品依据；仓库协作要求见 [AGENTS.md](AGENTS.md)。该文档记录长期目标与取舍，功能方向不代表已经实现；当前内容契约与运行方式以本 README 和代码为准。

## 架构

```mermaid
flowchart LR
  db[(SQLite publication heads)] -->|验证有效 release、edition、approval| exporter[bili-asr publication export]
  exporter --> content[公开 catalog + publish.md + review.md + manifest]
  db -->|选择当前且从未发布的 edition| draftExporter[bili-asr publication export-drafts]
  draftExporter --> drafts[未发布 catalog + preview.md + review.md + manifest]
  content --> validate[结构、文件集合、SHA-256 和 snapshotId 校验]
  drafts --> validate
  validate --> vite[Vite 静态构建]
  vite --> dist[dist 静态文件]
  dist --> browser[已发布与未发布目录、搜索与稿件]
  browser -->|修改建议关联精确 release| issue[GitHub Issue]
```

## 本地运行

需要 Node.js 20 或更新版本及 pnpm：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

默认地址为 `http://127.0.0.1:5173`。开发服务器启动及生产构建均校验两份公开快照。
仓库初始快照是合法空目录，查看未发布稿件不会产生审核或正式发布事实。

## 导入已发布稿

先在 `bilibili-asr-archive` 中按新稿件契约创建 edition、审核准确内容哈希并显式发布，然后导出：

```powershell
bili-asr publication export --archive-root C:\Archive\new-contract --out C:\Sites\markdown-reading-site\content
```

输出目录必须与源归档及产物根互不重叠。命令读取有效发布指针，只导出当前 release 的
`publish.md` 及该编辑版本对应 AI 修订的原始 `review.md`；创建 B 草稿或批准未发布的 B 时，
公开目录继续呈现 A。明确发布 B 后切换 B，
撤回当前版本后该分 P 从新快照中移除。审核与编辑命令详见主项目
[publication.md](https://github.com/SuperCatQR/bilibili-asr-archive/blob/main/docs/publication.md)。
后端契约实现与审核流程见 [主项目 PR #264](https://github.com/SuperCatQR/bilibili-asr-archive/pull/264)。
公开未发布预览的后端导出实现见 [主项目 PR #265](https://github.com/SuperCatQR/bilibili-asr-archive/pull/265)。

本仓库只接受新契约：

```text
content/
  catalog.json
  publication-export-manifest.json
  articles/part-<videoPartId>/publish.md
  articles/part-<videoPartId>/review.md
```

catalog 为 `{ "schemaVersion": 2, "manuscriptType": "publication", "articles": [...] }`。
两类快照可额外包含上游 `--series-file` 导出的 `series.json`；其路径和字节哈希必须登记在原 manifest 并参与 snapshotId。系列 v1 包含编辑源版本、确认依据、阅读顺序、准确绑定本类别目录及版本的成员，以及显式确认的缺失位置。构建拒绝陈旧、错类别、漏项、乱序和未登记关联。可选文件不改变 catalog 字段、正文、edition 或发布事实。维护格式见 [上游系列文档](https://github.com/SuperCatQR/bilibili-asr-archive/blob/main/docs/publication-series.md)。当前生产内容没有录入系列关联，不能从标题或标签推断。
每条记录冻结读者可见标题、摘要、标签、整理属性、编辑说明和来源，携带 edition/release/revision
标识、完整内容哈希、发布文件哈希、模板 `publish-v1` 与 Unix 秒发布时间。必需的 `reviewFile`
绑定同一分 P 的 `review.md`，`reviewArtifactSha256` 对应原始校验参照文件字节。manifest 仍使用
`schemaVersion: 1`，包含准确受管文件集合、每个文件的 SHA-256 及快照身份；构建核验正文与
校验参照都与 catalog、manifest 配对，且全文为有效 UTF-8。
32 位十六进制 edition ID 与 64 位 SHA-256/release/revision ID 区分校验。

旧数组或 v1 catalog、旧 manifest、旧正文命名、任何 `reviews/` 内部目录、未登记或残留文件、
缺失正文或校验参照、错误哈希、符号链接及路径逃逸都会拒绝。没有 v1 回退或兼容转换。
数据库、edition 与 release 无需迁移，也不需要重新批准或发布。旧 v1 受管输出目录不能原地
重新导出；请使用全新输出目录生成并验证 v2 快照，将旧快照保留在站点输入目录之外的备份中，
再整体替换 `content/` 和 `draft-content/` 两个根目录。

## 导入未发布稿件

在主项目中把当前且从未产生 release 的编辑版本导出到站点独立的 `draft-content/`：

```powershell
bili-asr publication export-drafts --archive-root C:\Archive\new-contract --out C:\Sites\markdown-reading-site\draft-content
```

该命令只读取稿件与审核状态，不批准或发布稿件。每个分 P 最多导出当前 edition；历史版本、
曾经发布的版本、已替换或撤回的 release 不会通过未发布入口重新公开。
已发布 A 与当前草稿 B 可以并存；审核 B 不会改变正式发布目录中的 A。
审核状态分别显示为“待审核”“审核中”“待修改”“未采用”“已审核 · 未发布”。
预览公开需要显式执行导出并提交快照；后端工作流生成或编辑稿件不会自动把它放到网站。
Pages 的生产构建读取 `draft-content/`，因此明确导入的 `pending-review` 稿件也可以在公开网站阅读。

```text
draft-content/
  catalog.json
  publication-draft-export-manifest.json
  drafts/edition-<editionId>/preview.md
  drafts/edition-<editionId>/review.md
```

草稿 catalog 使用 `{ "schemaVersion": 2, "manuscriptType": "publication-draft", "articles": [...] }`。
主题 `tags` 只使用源视频元数据中已采集的标签名称（主项目 `video_tags.tag_name`），按 BVID 对应稿件，
去重后保留原名称。不得从标题、编号或正文推断主题，也不得使用 AI 生成的分类；缺少标签时先补采
源视频元数据，获取失败时保留空值，不填入替代分类。
每条记录冻结读者元数据和来源，携带 edition/revision 标识、内容哈希、预览文件哈希、审核状态与
Unix 秒创建时间；`reviewFile` 固定为同一 edition 目录的 `review.md`，`reviewArtifactSha256`
校验原始参照字节。没有 release ID、发布时间或发布模板声明。manifest 保持 v1，类型为
`publication-draft-export`，对准确文件集合、SHA-256 与快照身份执行同样的严格验证。
已发布和未发布快照不可同时声明同一个 edition；内部 `editorial export` 包不能放入任一输入目录。

未发布正文和配对的校验参照都会进入公开站点的生产构建及部署文件。只导入已决定公开的内容；
校验参照保留原始 AI 基线说明、模型与规则标识。完整模型请求响应、审核演员、审计事件、
独立 AI 合成稿和补丁保持在内部审阅包中。

## 阅读与修改建议

首页默认展示“全部内容”，说明文字资料库的用途、视频与稿件数量，并按视频聚合分 P。
“全部内容”“已发布”和“未发布”各自搜索标题、摘要、正文和源视频标签，支持标签筛选与深浅主题。
正式发布目录为空时，提供明确的公开预览入口；预览稿始终保留真实审核状态。
目录页页头提供“全部内容、主题、最近阅读”，发布状态通过筛选框切换。主题入口先展示 12 个常用源标签与不同视频数量，支持搜索全部源标签和分批展开；Escape 关闭并恢复焦点。
阅读页固定工具栏提供返回目录、当前 P、查找、导览与排版；篇目入口显示完整标题及核对、纠错工具，站点导航与深浅主题集中在“更多”。
同一视频按分 P 数字顺序组织；同一分 P 的发布版与草稿分别显示。顶部 P 菜单与正文末尾提供同稿件类别的导航及连续阅读入口；跳跃编号明确说明本站尚未收录的范围，不推断原视频缺失或跨视频系列。
若快照包含编辑确认的系列，阅读页另提供系列说明、完整确认顺序及前后视频入口。经确认缺失或本类别暂无稿件的相邻位置显示说明，不生成跨类别链接。

搜索结果展示命中上下文与关键词高亮；正文命中链接使用 URL fragment 定位相应段落，打开后
高亮命中词。目录不展示自动首段摘录，保留已有编辑摘要；BV 号可直接打开原视频。
目录分批显示视频。返回目录与浏览器后退会恢复关键词、标签、展开的分 P 列表、已显示数量和
滚动位置；同一标签页刷新后继续保留。该状态通过 history 与 sessionStorage 保存，存储禁用时
当前页面的内存状态仍支持往返。默认综合搜索保持正文证据优先；输入查询后，可直接选择标题相关优先，无需展开高级查找。原句和全部关键词保持正文准入规则。结果默认显示一段短证据，其余命中按需展开；全部命中锚点保留。纯空白查询（含不换行空格）按空查询处理。查找方式和排序支持分享与恢复，当前生效方式及排序依据可见。加载索引期间移除旧结果，长等待可清空取消，失败可重新请求。

阅读排版提供 17/19/21px 字号、三档行距、620/760/920px 桌面行宽与宋体/黑体风格，手机宽度受屏幕限制。设置仅保存在当前浏览器，存储失败会明确提示；调整排版保持当前正文块及段内位置。正文有真实小标题时提供原文目录，没有时按原文正文块与摘录提供段落导览，不生成章节或改写快照。字体使用系统回退，不要求外部字体服务完成加载。实现依据与复测见 [访客体验修复说明](docs/visitor-experience-fixes.md)。

正文阅读位置独立保存到当前浏览器的 localStorage；目录直接显示最近一篇的标题、P 和继续入口，其余记录、删除、清空与存储说明在次级管理区域。最多保留 20 篇，180 天后到期。记录绑定稿件类别、分 P、edition、正文内容及文件哈希，发布稿另绑定 release；使用段落锚点和段内相对位置恢复。连续阅读记录实际可见的 P，重开只请求该篇。内容更新时从新版开始，撤回时不恢复旧位置。校验参照不覆盖正文记录；显式链接锚点与页面历史优先，本地恢复由读者选择。打开查找或本文目录前保留正文位置，关闭、取消或返回可继续原处，工具滚动不覆盖进度；明确选择命中或主动回到正文阅读后恢复保存。存储不可用或记录损坏不阻止阅读，也不宣称保存成功；不提供跨设备同步。

构建插件先验证两份输入快照，再派生阅读时间与两类独立的 JSON 搜索索引。派生数据
不写入 `content/` 或 `draft-content/`。首页只加载目录元数据、阅读时间和文档 URL；首次输入搜索词时
加载对应正文索引；阅读页的视频内查找只加载当前视频与所选稿件类别的分片，不回退到全库下载。正文命中提供按真实 P 和段落顺序的上一处、下一处、序号、返回结果与结束查找，跨 P 绑定准确版本和完整查询。打开稿件时只请求当前 Markdown，校验参照独立按需请求。搜索索引不包含
校验参照。索引和文档带内容指纹，与静态托管的子路径部署兼容；加载失败提供重试入口。

全站搜索现在先请求与查询有关的二字符候选分区，再以最多 8 个并发请求加载候选视频的正文分片，最后执行完整精确搜索。单字或候选超过当前类别 60% 的宽泛查询使用完整索引；不减少搜索方式、正文证据或排序。空查询不加载索引，取消或改词停止旧队列，失败可重试。

搜索大标题进入按实际 P 和正文顺序的首个命中，传递完整查询、方式及类别；纯元数据匹配不虚构段落。命中操作菜单支持 Escape 与外部点击关闭。真正从全站列表进入的阅读可恢复原列表状态与位置，本视频命中另有独立入口；直接分享只提供重新搜索，不能恢复不存在的前序列表。最近阅读区的手机标题默认两行，可点击或用键盘展开完整标题，继续阅读与管理入口同行。

文章内的“正文 / 校验参照稿件”只切换当前编辑版本的视图，独立于页头的稿件分类。
从目录进入文章后，返回链接回到原目录；直接打开文章时回到其所属的已发布或未发布目录。
未找到页面不高亮任何分类。阅读页保留当前审核及发布状态，冻结的整理归属、编辑说明、完整版本与修改建议集中在默认收起的“来源与整理说明”，并说明
稿件处理状态不构成对视频中全部观点的学术认证。
发布稿读取完整的 `publish.md`，展示冻结视频来源、发布时间以及可展开的 release/edition/hash。
未发布稿读取完整的 `preview.md`，按 `?draft=<editionId>` 定位，展示创建时间、审核状态和准确
edition/hash，并提示“未经正式发布，信息待核验”。每篇稿件都提供“正文 / 校验参照稿件”入口，
`?review=<32位editionId>` 必须在两份 catalog 中唯一匹配，由其归属显示已发布或未发布分类。
未知标识、重复参数、同时指定 `review` 与 `read` / `draft` / `view` 都返回未找到。

校验参照是 `aiRevisionId` 对应的 AI 初稿基线，展示完整原文、整理稿、疑点、候选、依据及视频
回看链接。后续人工编辑可能改动正文；参照中的“未经人工复核”描述基线生成时的情况，
当前稿件审核状态另行显示。它不构成人工审核记录，也不因关联稿件获批或发布而重写。
“复制 Markdown”复制当前视图原始完整文件，校验参照版本详情显示原始文件 SHA-256。
目录搜索仍只搜索稿件正文与读者元数据。两类 Markdown 的原始 HTML 均被禁用，外链采用
`noopener noreferrer`。

读者可以提交预填 GitHub Issue，描述修改建议并关联准确 edition、AI 修订和内容哈希；正式发布稿还关联 release。
从校验参照发起的建议另带参照文件哈希和对应 `?review=` 链接。
阅读工具中的“核对”保留当前正文段落与阅读位置：仅在完整版本身份相同且参照整理稿文本唯一、完全匹配时定位；重复文本提供候选，编辑后无法匹配时提示参照内查找。返回正文保留原来的查询、锚点与连续阅读状态。
参照按段区分原文、整理稿与疑点，生成信息默认收起；未知模板完整展示，原始 Markdown 仍可查看、复制。顶部“查找”在参照视图中只搜索已加载的当前参照，支持上一处、下一处、展开隐藏命中及返回阅读处，不加入目录或视频正文索引。
“纠错 / 反馈这一段”打开站内反馈面板，可带入选中文本或当前段落，补充上下文、建议与理由；完整反馈包含段落链接、edition、AI 修订、内容及文件哈希，正式稿另含 release，参照有实际时间段与来源链接时一并附上。无需登录即可复制建议，实际 GitHub 提交需要登录。建议按完整版本与正文/参照分别暂存于 sessionStorage，最多保留 10 份，每项字段最多 4000 字符；会话结束后不保证保留，也不提供跨设备同步。存储与复制失败分别提供明确提示和手动复制文本；超过预填链接长度时要求复制粘贴，保留完整建议与版本证据。
Issue 讨论不会自动改写文章或审核事实；维护者需在主项目中创建新 edition、审核及发布。
内部审阅包使用 `bili-asr editorial export` 单独导出，不能放入此站点内容目录。

P0 的实现对应与浏览器复测方式见 [P0 阅读体验交付说明](docs/p0-reading-experience.md)。
本次开放 issues #39–#48 的实现、测量条件、阅读进度边界和回归依据见 [阅读体验修复交付说明](docs/issues-reading-improvements.md)。
后续 issues #51–#56 的评估、工具与进度保护、局部索引及进一步阅读排版见 [第二轮阅读体验修复](docs/followup-issues-reading.md)。#57、#59–#63 的系列契约、搜索上下文、候选索引及最近阅读布局见 [第三轮修复说明](docs/third-round-reader-fixes.md)；系列当前完成维护与消费契约，现有内容关联等待编辑确认。
贡献者 issues #70–#73 的实现、测量和边界见 [贡献者体验修复说明](docs/contributor-experience-fixes.md)。
目录直达正文、阅读页内分 P 切换与视频搜索、原句与多关键词反查及多个段落命中已实现，范围与复测方式见 [内容发现交付说明](docs/discovery-experience.md)。原独立视频总览已移除，旧链接兼容到阅读页。[内容反查与多分 P 阅读计划](docs/next-reading-features.md)中的连续阅读模式已实现，按类别逐篇加载、指定 P 分享与历史恢复的范围见 [连续阅读交付说明](docs/continuous-reading.md)。

## 构建与部署

```powershell
pnpm test
pnpm validate
pnpm build
```

本仓库包含 GitHub Pages 工作流；Pages 来源设为 GitHub Actions 后，推送 `main` 会构建并部署。
公开地址为 `https://supercatqr.github.io/markdown-reading-site/`。
导出的 `content/` 与 `draft-content/` 分别作为快照提交；编辑、正式发布、撤回或替换后重新导出两份
快照、构建和部署，确认托管端旧文件和 CDN
缓存清理。后端的本地快照更新不能撤销已部署副本。
