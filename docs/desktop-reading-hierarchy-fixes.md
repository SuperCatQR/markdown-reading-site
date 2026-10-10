# 阅读层级与切换修复

## 用户与产品依据

这次改动针对 2026-10-10 访客审查提交的 #80–#91，服务按分 P 连续学习的人、通过概念复习的人和核验贡献者。依据 [项目哲学](product-philosophy.md) 第 3、4、5、8 节，让读者理解当前视频、分 P、稿件视图、阅读方式与返回目标；从目录直接进入正文，将查找和核验作为按需工具。

## 逐项交付与验收

| Issue | 改动后的行为 | 验证任务 |
| --- | --- | --- |
| [#80](https://github.com/SuperCatQR/markdown-reading-site/issues/80) | 加载下一 P 后将该篇定位在固定页头下方 | P1 → P2，确认正文、当前 P 与 URL 同时到达 P2 |
| [#81](https://github.com/SuperCatQR/markdown-reading-site/issues/81) | 连续流依据实际可见篇目更新地址、目录选中项与模式链接 | 从 P2 回滚 P1，复制 URL 在独立页面打开仍为 P1 |
| [#82](https://github.com/SuperCatQR/markdown-reading-site/issues/82) | 视频查找在独立滚动面板中展示 | 输入宽泛查询，结果增长不把正文挤到数屏以下 |
| [#83](https://github.com/SuperCatQR/markdown-reading-site/issues/83) | 当前身份固定显示；来源与导览只有一个工具层，版本再展开一次 | 开关来源和版本，段落及段内位置保持一致，无三层折叠 |
| [#84](https://github.com/SuperCatQR/markdown-reading-site/issues/84) | 正文 / 校验参照固定选中；工具分别称视频查找 / 参照查找 | 参照滚动后仍可辨认视图；查找提示仅当前参照；回正文恢复 URL 与位置 |
| [#85](https://github.com/SuperCatQR/markdown-reading-site/issues/85) | 单篇 / 连续阅读传递查询、方式、范围与对应命中锚点，连续模式的搜索结果与逐处查找保持阅读方式 | 查询后单篇 → 连续 → 单篇，再浏览器后退 / 前进，查询仍在；命中锚点在两种格式间准确转换 |
| [#86](https://github.com/SuperCatQR/markdown-reading-site/issues/86) | 已有 sourceMetadata.partTitle 显示于目录、固定身份、结果与最近阅读 | 真实“主义主义-介绍”显示；未知标题明确提示； HTML 转义测试 |
| [#87](https://github.com/SuperCatQR/markdown-reading-site/issues/87) | 最近阅读独立展示完整记录，选中对应导航，不夹杂搜索结果 | 进入最近阅读，仅有记录与管理；完整列表不会重复最近一篇 |
| [#88](https://github.com/SuperCatQR/markdown-reading-site/issues/88) | 主返回入口明确指向全站搜索结果、最近阅读或对应目录 | 全站命中进入正文后直接返回，原查询恢复；最近阅读进入后返回最近阅读 |
| [#89](https://github.com/SuperCatQR/markdown-reading-site/issues/89) | 搜索范围说明只筛选结果，不切换当前正文或版本 | 草稿正文内选择已发布搜索范围，仍显示原草稿及其真实状态 |
| [#90](https://github.com/SuperCatQR/markdown-reading-site/issues/90) | 综合搜索将完整标题精确匹配置前，其他正文证据优先规则保持 | “一分钟哲学课”标题结果首位；原句与全部关键词仍要求正文命中 |
| [#91](https://github.com/SuperCatQR/markdown-reading-site/issues/91) | “恢复默认查找”明确清空查询 / 主题并恢复综合 / 默认排序；预览入口保留查询方式；无结果提示解释当前方式 | 原句无结果 → 重置，检查各控件；空发布目录 → 预览，检查 query / mode |

桌面左侧保留同视频目录，正文保持独立阅读区域。工具面板在桌面作为右侧栏，在小于 1100px 的窗口作为模态抽屉。关闭工具按正文块和段内比例恢复；跨断点调整窗口时关闭工具，重新打开采用正确的焦点模式。排版与反馈打开前关闭已有工具，避免对话框叠加。连续阅读下一 P 加载失败时保留已加载正文，并以明确 P 链接重试失败篇目。

参照查找展示当前命中摘录，“阅读此命中”关闭工具并保留该段；关闭或取消则返回原阅读位置。结束正文逐处查找时移除查找栏并保持当前段落，避免页头高度变化造成跳读。

## 验证记录

本地 Node 测试 122 项全部通过，包含新增的 URL 与命中锚点往返、连续模式查找、稿件视图与阅读方式、来源标题转义、精确标题优先、无结果方式和完整最近记录测试。将精确标题相等条件反转后，相应回归测试失败；随后恢复代码并通过完整测试，证明测试能够捕获该规则退化。

`pnpm build` 已通过，先验证 0 篇已发布、1228 篇未发布快照。此 Windows 环境的系统临时目录会拒绝 esbuild 删除输入文件；使用工作区内已忽略的 `.tmp/build-temp` 作为 TEMP/TMP 完成生产构建，没有修改依赖或构建契约。

真实生产构建的浏览器验收通过 #80–#91，检查 1920、1366、390、320px 宽度、深色主题、工具 Escape 与焦点返回、来源开关段内恢复、浏览器前后退、独立页面分享、加载失败重试和窗口跨断点。构建额外使用实际 `/markdown-reading-site/` 部署子路径复测。无页面脚本异常。可重跑：

```powershell
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4173
playwright-cli -s=hierarchy-fix open http://127.0.0.1:4173
playwright-cli -s=hierarchy-fix run-code --filename=scripts/browser-reading-hierarchy-check.js
```

脚本以当前冻结生产样本的 P1/P2 和来源分段名作为验收输入；更新快照时应同步选择等价的真实样本。浏览器断言依据结果内容，CLI 的进程退出码不能代替 `passedIssues` 和 `errors` 检查。窄屏验证是浏览器模拟视口，未在实体手机上测试。

代码审查覆盖正确性、可读性、架构、安全与性能：阅读路由、正文位置、面板生命周期与展示分别使用独立模块；路由与来源身份保持契约校验，来源名称与 URL 输出转义；保留按视频加载索引和按需请求正文，未新增依赖。已补测审查中发现的失败篇目重试、命中锚点转换、连续模式查找、抽屉中的参照阅读和结束查找位置恢复。

没有改写任何冻结 Markdown、sourceMetadata、origins、manifest 或哈希。校验参照仍是 AI 初稿基线，公开预览仍是未发布稿件；静态前端修复不产生审核或正式发布事实。代码提交与 PR 验证不等于 GitHub Pages 已部署，线上版本由主分支部署工作流交付。
