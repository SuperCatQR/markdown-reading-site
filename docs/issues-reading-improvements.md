# 阅读体验修复交付说明

日期：2026-10-09。基线为 `main` 的 `015444fece2154aeedc08d7e43a8972fba8998ed`，实现位于独立 worktree 的 `codex/fix-all-reader-issues`。本文描述分支实现，不代表 main 或线上已经更新。全部 25 个 issues 的初始评估见 [评估与计划](issues-assessment-and-fix-plan.md)；本次修复全部 10 个开放 issues #39–#48，保留已关闭问题的决定。

依据 [项目哲学](product-philosophy.md)，服务首次访问的文字读者、凭概念找回上下文的复习者、持续学习同一视频的人及需要核验来源的读者，改善“找到一讲、进入正文、长文中段导航、中断后继续”。采用内容优先、辅助信息按需展开、手机与键盘可用及准确版本关联的原则。未修改冻结内容、导入契约、依赖或审核与发布事实。

## Issue 与最终行为

| Issue | 分支实现 | 主要验证 |
| --- | --- | --- |
| [#39](https://github.com/SuperCatQR/markdown-reading-site/issues/39) 阅读前置信息 | 当前真实状态与完整标题保留；来源、编辑说明、准确版本与反馈集中在默认收起的原生 details；正文与参照分别说明 | 长标题正文提前、键盘展开来源与版本、edition/64 位哈希及参照反馈哈希、复制原始 Markdown |
| [#40](https://github.com/SuperCatQR/markdown-reading-site/issues/40) 首页首屏 | 合并用途和数量介绍，减少重复预览入口；搜索、完整首条标题和阅读入口前移 | 320/390/1440px、深浅主题、合成四种发布/草稿状态与空摘要 |
| [#41](https://github.com/SuperCatQR/markdown-reading-site/issues/41) 最近阅读与进度 | 独立本地版本记录、显式恢复、更新与撤回处理、删除和清空；连续阅读按实际可见 P 保存 | 单篇、新标签页、同页最近阅读、段内偏移、hash/history 优先、参照隔离、存储异常与跨标签页旧写保护 |
| [#42](https://github.com/SuperCatQR/markdown-reading-site/issues/42) 中段导航 | 64px 固定工具栏：返回、实际当前 P、查找、有真实标题时的本文目录；分类与主题在“更多” | 单 P 简化、真实 P1–P13、类别隔离、中段聚焦输入、滚回前 P、200% 文字重排 |
| [#43](https://github.com/SuperCatQR/markdown-reading-site/issues/43) 搜索等待 | 立即移除旧结果；4 秒长等待提示、清空取消、失败重试；共享索引失败缓存清除与阶段计时；缓存归一化正文 | 慢响应、换词、取消、离开、类别切换、迟到响应、IME、503 重试、冷/热阶段测量 |
| [#44](https://github.com/SuperCatQR/markdown-reading-site/issues/44) 目录信息层级 | 保留完整长标题、真实 P 与版本；单 P 减少重复数量；来源“原视频”并保留 BV 身份 | 单 P、多 P、同 P 两类别版本、空摘要、完整可访问标题及源链接 |
| [#45](https://github.com/SuperCatQR/markdown-reading-site/issues/45) 排序 | 可见日期及默认正文排序说明；综合搜索可选标题相关优先，URL/history/session 恢复 | 标题与正文冲突、正文准入、最相关 P 聚合及组内数字顺序、分享缺省 sort 不继承旧会话 |
| [#46](https://github.com/SuperCatQR/markdown-reading-site/issues/46) 辅助字号 | 重要元数据至少 13px、说明 14px，主要操作 44px，手机正文 17px | 深浅主题对比度门禁、320/390px、200% 文字重排、焦点及固定头无遮挡 |
| [#47](https://github.com/SuperCatQR/markdown-reading-site/issues/47) 高级查找 | 原生 details 默认收起，生效方式在外可见；非默认 mode/sort 自动展开 | 键盘、原句共享与历史恢复、原句和全部关键词准入保持、特殊方式禁用标题排序 |
| [#48](https://github.com/SuperCatQR/markdown-reading-site/issues/48) 标签探索 | “按主题筛选”；文章原始源标签为编码后的目录探索链接，保留准确返回类别 | 标签原名、编码、空查询新探索、直接链接稿件类别与目录返回状态 |

## 阅读恢复契约

`reading-history.js` 负责 schema、身份、有限存储及版本校对；`reading-history-browser.js` 负责正文视口、段落位置和交互。与目录 session 状态、主题偏好分开。

- 最多 20 篇，180 天到期，保存在当前浏览器 `localStorage`。记录稿件类别、分 P/BVID/P、edition、内容 SHA-256、正文文件 SHA-256；发布稿保留 release。缓存标题不用于判断版本一致性。
- 只记录实际可见正文段落，滚动触发保存；只打开标题区不制造正文位置。段落锚点及段内比例用于恢复，连续阅读去除 Edition 前缀保存，再按准确 P 构建链接。新页面只请求目标篇，不恢复旧 loaded 集合。
- 用户主动选择本地继续；新导航的显式 hash 或搜索命中优先，历史往返保留自身位置。普通打开同篇提供提示，不强行跳转。连续模式实际可见 P 可以不同于 URL 最后选择 P。
- 内容版本不一致仅提供从新版开始；缺失或撤回不提供旧位置链接。参照滚动不覆盖正文记录。损坏 JSON、未知 schema、配额不足和存储拒绝均可继续阅读，失败有说明；只有明确清空才重置损坏或未知格式。
- 写入前重新读取，按阅读时间合并；删除及清空保留时间标记，阻止较旧标签页的延迟写复活记录。不承诺跨设备同步、收藏、记录导出或服务端持久化。
- 查找结果位于正文前，异步完成可能改变布局。单篇和连续模式共用恢复协调器：完成后重放同一准确位置；wheel、touchmove、keydown、pointerdown 后不再主动定位，离开路由清理监听。审查发现并修复了“同页继续被再次 hash 定位覆盖”和“连续模式搜索结果改变恢复位置”两个问题。

## 布局与性能证据

Windows、Headless Chromium 155，本地 Pages 子路径生产预览；使用实际超长标题“先验直觉主义”P1、当前 320 篇未发布稿/247 个视频及空已发布目录。模拟视口，不是真机。

| 指标 | 320px | 390px | 1440px |
| --- | ---: | ---: | ---: |
| 首页完整首条标题底部 | 643px | 615px | 453px |
| 首页首条阅读入口底部 | 737px | 709px | 547px |
| 同篇长标题文章首段顶部 | 850px | 771px | 615px |
| 阅读固定头高度 | 64px | 64px | 64px |
| 检查到的关键辅助文字最低字号 | 13px | 13px | 13px |

390×844 的首段由评估基线约 1196px 前移 425px。深浅主题布局一致，没有横向溢出。200% 验证采用文字字号加倍后的重排，检查 390px 首页及单篇、320px 多 P 工具仍在固定头内；未宣称原生浏览器 zoom 或真机结果。截图和指标由脚本输出到忽略的 `artifacts/`。

冷搜索禁用 HTTP 缓存，无网络限速；三次均查询“海德格尔”，返回 92 篇。正文索引 `search-drafts-5zc34vXK.json`，解压 7,825,296 字节、gzip 正文 2,670,148 字节。总计时不含 120ms 输入防抖和后续绘制。

| 阶段 | 第 1 次 | 第 2 次 | 第 3 次 |
| --- | ---: | ---: | ---: |
| 请求至响应 | 113.4ms | 94.8ms | 76.0ms |
| 下载 | 348.1ms | 393.1ms | 326.6ms |
| JSON 解析 | 4.3ms | 6.7ms | 3.9ms |
| 一次归一化 | 46.7ms | 35.4ms | 31.6ms |
| 搜索计算 | 6.9ms | 7.5ms | 10.6ms |
| 结果 HTML | 3.1ms | 2.2ms | 2.1ms |
| DOM 更新 | 2.6ms | 1.6ms | 1.3ms |
| 冷查询合计 | 527.1ms | 542.0ms | 453.1ms |
| 页面内缓存查询 | 10.5ms | 11.5ms | 7.3ms |

计时只包含阶段及索引身份，不记录查询内容。WeakMap 缓存归一化结果，不改写冻结索引或展示文本。上述本机结果不能认定线上“90 秒”的根因，未引入分片或 Worker；索引下载体积仍有成本。

## 复测

`pnpm test`、`pnpm validate` 与 Pages 子路径构建作为基础门禁。Playwright CLI 复用现有安装：

```powershell
pnpm test
$env:VITE_BASE_PATH='/markdown-reading-site/'
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4179 --strictPort
# 在另一个终端执行
playwright-cli -s=issues open http://127.0.0.1:4179/markdown-reading-site/
playwright-cli -s=issues run-code --filename=scripts/check-search-browser.js
playwright-cli -s=issues run-code --filename=scripts/check-reading-history-browser.js
playwright-cli -s=issues run-code --filename=scripts/check-issue-layout-browser.js
playwright-cli -s=issues run-code --filename=scripts/check-reader-browser.js
playwright-cli -s=issues run-code --filename=scripts/check-continuous-browser.js
playwright-cli -s=issues run-code --filename=scripts/check-discovery-browser.js
playwright-cli -s=issues run-code --filename=scripts/check-reader-errors.js
playwright-cli -s=issues run-code --filename=scripts/check-reader-video-errors.js
playwright-cli -s=issues run-code --filename=scripts/check-overview-browser.js
playwright-cli -s=issues run-code --filename=scripts/check-title-browser.js
playwright-cli -s=issues close
```

浏览器示例依赖当前实际内容，导入变化后应调整示例。原脚本只适配有意改变的 details 可见性、主题入口、等待反馈与浏览器 runner 的 URL 全局限制，保留正文证据、请求范围、失败重试与历史隔离断言。

最终 68 项单元测试通过。版本一致性关键条件反转后进度单元测试失败，恢复后通过；最终恢复机制另通过浏览器条件反转验证。同页最近恢复与保留视频查询的连续历史恢复、实际 P、新页面请求数、存储失败四类及原有阅读/搜索/错误回归均纳入交付检查。按正确性、可读性、架构、安全与性能完成审查。
