import { partIndex } from "./source-identity.js";
import { escapeHtml } from "./ui.js";

export function readingOutlineMarkup({ headings, blocks = [] }, label = "本文目录", { panel = false } = {}) {
  if (panel) {
    const markup = readingOutlineMarkup({ headings, blocks }, label);
    return markup.replace(/^<details/, '<section').replace(/<summary>(.*?)<\/summary>/, '<h3>$1</h3>').replace(/<\/details>$/, '</section>');
  }
  const toc = headings.filter(({ level }) => level > 1);
  if (toc.length) return `<details class="table-of-contents"><summary>${label}</summary><nav aria-label="文章目录"><ol>${toc.map(({ id, text, level }) => `<li class="toc-level-${level}"><a href="#${encodeURIComponent(id)}">${escapeHtml(text)}</a></li>`).join("")}</ol></nav></details>`;
  if (blocks.length < 2) return "";
  const step = Math.max(1, Math.ceil(blocks.length / 10));
  return `<details class="table-of-contents paragraph-outline"><summary>段落导览 · ${blocks.length} 个正文块</summary><p>按原文顺序定位；下列文字摘自对应段落开头，不是编辑章节。</p><nav aria-label="原文段落导览"><ol>${blocks.filter((_, i) => i % step === 0).map((block, i) => `<li><a href="#${encodeURIComponent(block.id)}"><span>第 ${i * step + 1}–${Math.min((i + 1) * step, blocks.length)} 块</span>${escapeHtml(block.text.slice(0, 46))}${block.text.length > 46 ? "…" : ""}</a></li>`).join("")}</ol></nav></details>`;
}

export function missingPartRanges(entries) {
  const pages = [...new Set(entries.map((entry) => partIndex(entry) + 1))].sort((a, b) => a - b);
  const missing = [];
  let previous = 0;
  for (const page of pages) {
    if (page > previous + 1) missing.push([previous + 1, page - 1]);
    previous = page;
  }
  return missing;
}

export function partGapsMarkup(entries) {
  const ranges = missingPartRanges(entries);
  return ranges.length ? `<p class="part-gaps">本站尚未收录 ${ranges.map(([first, last]) => first === last ? `P${first}` : `P${first}–P${last}`).join("、")}；导航只连接已收录部分，不代表原视频缺失。</p>` : "";
}
