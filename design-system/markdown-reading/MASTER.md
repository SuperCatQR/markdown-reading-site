# 档案室设计维护说明

本文记录当前站点的设计实现，替代原有生成器建议。运行时样式以 `src/site.css` 为准，页面结构以 `src/main.js` 为准；修改视觉规则时同步更新本文。未实现的通用组件、间距 token 和动画建议不构成本项目规范。

## 页面与组件

- 目录页：`.page-shell`、`.page-heading`、`.directory-tools`、`.video-group`、`.video-part`；按视频聚合，支持正文命中上下文、标签筛选与分批显示。
- 阅读及校验参照页：`.reading-shell`、`.reading-heading`、`.document-tabs`、`.parts-navigation`、`.table-of-contents`、`.prose`。
- 公共元素：`.site-header`、`.theme-toggle`、`.site-footer`。
- 内容说明：`.library-notice`、`.draft-notice` 说明公开预览状态；`.review-reference-notice` 说明 AI 基线参照；`.provenance` 展示来源、整理与编辑说明。
- 状态标签：`.draft-state` 与 `data-status`；审核和正式发布分别表达，已审核草稿仍标为未发布。
- 搜索定位：`mark`、`.search-passage`、`.search-arrival`；安全高亮并定位正文，不改写复制的原始文件。
- 视频总览：`.video-overview-heading`、`.video-versions`、`.video-search`；使用既有纸面、排版与颜色，保留源标签与版本状态，列出实际收录分 P。
- 内容反查：原生单选 `.search-modes`、`.search-help`、`.passage-list`、`.passage-disclosure`；默认展示两个命中，再展开其余证据，每个片段可单独定位。避免为搜索增加模态窗口，保持输入框和键盘焦点稳定。

## 颜色

暖色纸面、深色文字与玫红强调色构成编辑部风格。变量名沿用实际 CSS，不使用生成器的 `--color-*` 命名。

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--paper` | `#faf9f7` | `#191817` | 页面背景 |
| `--surface` | `#ffffff` | `#242220` | 行项目与控件背景 |
| `--ink` | `#24211f` | `#f4eee8` | 正文与标题 |
| `--muted` | `#6d6761` | `#b7ada4` | 摘要与次要说明 |
| `--faint` | `#726a63` | `#9e948b` | 日期、行号、页脚、占位文本 |
| `--line` | `#e7e1dc` | `#3a3531` | 边框与分隔线 |
| `--soft` | `#f3efec` | `#2c2926` | 控件与代码背景 |
| `--accent` | `#c64668` | `#f08aa4` | 强调色与交互反馈 |
| `--accent-strong` | `#a93253` | `#ffabc0` | 强调文字 |
| `--accent-soft` | `#f7e5ea` | `#4a2934` | 强调背景 |
| `--green` | `#286e56` | `#87c3a7` | 主题与通过状态 |
| `--gold` | `#8a5c18` | `#e2b868` | 主题与审核说明 |
| `--focus` | `#a93253` | `#ffabc0` | 键盘焦点 |

辅助文字在纸面、表面及柔和背景上的对比度必须至少为 4.5:1。主题标签需计算半透明色底叠加纸面与表面后的实际对比度；搜索高亮、结果计数、分 P 链接与命中提示也需满足 4.5:1。`test/contrast.test.js` 直接读取 CSS 前景、混色比例与主题变量，作为 `pnpm test` 和 Pages CI 的回归门禁。

## 字体与加载

`src/site.css` 顶部使用 Google Fonts CSS `@import` 加载 Libre Bodoni（400–700）与 Public Sans（300–700），设置 `display=swap`。

- 界面文字：Public Sans、Noto Sans SC、system-ui、sans-serif。
- 页面与阅读标题：Libre Bodoni、Georgia、serif。
- 阅读正文：Georgia、Noto Serif SC、Songti SC、serif；正文内标题使用界面字体。
- 代码文字：Public Sans、monospace，沿用当前实现。

Noto Sans SC、Noto Serif SC 与 Songti SC 是本地字体候选，本站未下载它们；无法使用时依次回退。Google Fonts 请求失败时也允许系统字体正常展示。旧版 DM Mono 与 Manrope 声明已移除。

## 布局、间距与阴影

目录容器最大宽度 1180px，阅读容器最大宽度 1040px，正文宽度最多 760px。响应式断点为 780px 与 430px。间距直接定义在各组件规则中，当前没有 `--space-*` token。

仅实现 `--shadow-sm` 与 `--shadow-md`，随主题调整；不额外要求通用 `.card`、`.modal` 或 `.btn-primary` 等未存在的组件。

## 交互与验证

- 控件保留键盘焦点、可读标签及主题切换状态。
- 提供跳到内容链接；搜索和正文加载有反馈与重试，手机输入字号至少 16px。
- 搜索输入期间只刷新结果，中文组合期间保持输入框；主题筛选使用原生 details。
- 返回目录恢复搜索、标签、展开分 P、显示数量与位置；同视频导航只使用已收录且同稿件类别的分 P。
- 悬停反馈主要采用颜色、阴影与小幅位移，具体时间以 CSS 为准。
- `prefers-reduced-motion` 下关闭平滑滚动并缩短过渡与动画。
- 修改后运行 `pnpm test` 和 `pnpm build`；布局变化另需检查目录、阅读与审核视图在深浅主题及移动宽度下的表现。
