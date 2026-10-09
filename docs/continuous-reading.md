# 连续阅读交付说明

依据 [项目哲学](product-philosophy.md)，本次服务持续学习同一视频的读者，将逐篇打开、返回再找下一 P 的过程改为同页保留前文、按来源顺序追加正文。对应 [下一阶段计划](next-reading-features.md) 第四步。

## 已实现

- 单篇阅读页的多 P 导航提供“从此 P 连续阅读”入口，绑定当前稿件类别与精确版本；单 P 不显示重复入口。旧连续阅读链接继续可用，空类别显示无收录提示，无草稿补齐发布稿的行为。阅读流可返回当前单篇正文，加载下一篇期间可返回已经加载的单篇。
- `?video=<BVID>&view=drafts|published&flow=continuous` 打开所选类别首个已收录部分；`part=<Edition ID>` 精确指定当前部分，支持分享和刷新。
- 初次只加载当前部分，点击“加载下一部分”追加下一篇；分 P 目录可直接跳到指定篇，不请求中间正文。已加载部分按真实 P 编号排列在同一阅读流中。
- 每篇保留 P 编号、原视频、审核与发布状态、整理说明、版本信息、单篇正文、校验参照和复制原始 Markdown。校验参照独立打开，正文与参照均提供返回连续阅读入口。
- 页内历史保存当前视频、类别、Edition、已加载集合与滚动位置。同次页面会话中后退、前进及从单篇返回时恢复；恢复已有正文不重复请求。
- 加载失败保留已经打开的正文、分 P 导航和总览入口，支持重试。离开后迟到的响应不覆盖目标页面。
- 多篇文章的标题、段落和目录锚点加入 Edition 前缀，防止跨篇重名；阅读流保留单个页面一级标题，单篇链接与原锚点继续兼容。

## 边界与取舍

保持独立静态前端，未新增依赖，未修改冻结快照。连续阅读只是展示结构，不创建新的合辑 release，不合并或改写输入 Markdown，也不推断视频总 P 数与完整性。

刷新或新页面分享仅加载 URL 指定的当前篇，避免一次请求旧历史中的所有正文。已加载集合和页内像素位置只用于页面历史；后续新增独立的准确版本本地进度和最近阅读，关闭会话后可显式继续实际可见 P，见 [阅读体验修复交付说明](issues-reading-improvements.md)。不承诺跨设备同步。版本详情展开状态不随阅读流重新渲染恢复。

正文解析结果在当前页面缓存，追加新部分不重复解析已加载文章。读者操作仍会重新绘制阅读流，极长合集的 DOM 成本可依据实际内容规模进一步测量。滚动历史写入节流，离开或跳转时立即保存。

同时修正 Vite `assetsInlineLimit` 的配置层级，将其放入 `build`，确保短 Markdown 也输出为独立文件；否则短正文会内联进 JavaScript，破坏按篇请求的边界。既有搜索索引约 7.8 MB、目录摘要约 503 kB 的体积问题仍待后续优化。

## 验证

运行 `pnpm test`、`pnpm build --base=/markdown-reading-site/` 和以下已安装 Playwright CLI 的脚本：

```powershell
playwright-cli -s=p0 open http://127.0.0.1:4174/markdown-reading-site/
playwright-cli -s=p0 run-code --filename=scripts/check-continuous-browser.js
playwright-cli -s=p0 run-code --filename=scripts/check-discovery-browser.js
playwright-cli -s=p0 run-code --filename=scripts/check-reader-browser.js
playwright-cli -s=p0 run-code --filename=scripts/check-reader-errors.js
```

合成测试覆盖类别隔离、Edition 绑定、编号间隔、空发布类别、非法及冲突参数、跨篇锚点和安全渲染。真实 13 分 P 浏览器流程覆盖首篇与下一篇独立请求、保留前文、P10/P13 跳转、历史位置与集合恢复、单篇/参照返回、刷新与新页分享、空类别、失败重试、迟到请求、无效 hash 和 375/768/1440 宽度及深浅主题。截图输出到忽略的 `artifacts/`。浏览器示例依赖当前内容，导入变化后应更新示例。

交付验证：45 项 Node 测试、快照校验、Pages 子路径生产构建、新连续阅读浏览器脚本及原有三个浏览器脚本全部通过。反转发布/草稿选择条件后，类别隔离测试失败；恢复后全部通过。合并前已按正确性、可读性、架构、安全与性能审查，修复短正文内联与滚动保存定时器复用的问题。
