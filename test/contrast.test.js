import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/site.css", import.meta.url), "utf8");

function rgb(hex) {
  return hex.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
}

function luminance(color) {
  return color.map((channel) => channel <= 0.04045
    ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function declaration(selector, property) {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `Missing selector ${selector}`);
  const block = css.slice(start, css.indexOf("}", start));
  const value = block.match(new RegExp(`(?:\\{|;)\\s*${property}:\\s*([^;]+);`))?.[1];
  assert.ok(value, `Missing ${property} in ${selector}`);
  return value;
}

function tokenColor(value, tokens) {
  const name = value.match(/^var\(--([\w-]+)\)$/)?.[1];
  assert.ok(tokens[name], `Unknown color ${value}`);
  return tokens[name];
}

function mix(foreground, background, alpha) {
  return background.map((channel, index) => channel * (1 - alpha) + foreground[index] * alpha);
}

for (const [theme, selector] of [["light", ":root"], ["dark", ':root[data-theme="dark"]']]) {
  test(`${theme} auxiliary text, tag chips and small emphasis meet AA`, () => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `Missing ${theme} theme`);
    const block = css.slice(start, css.indexOf("}", start));
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)]
      .map(([, name, value]) => [name, rgb(value)]));
    for (const [name, background] of ["paper", "surface", "soft"].map((name) => [name, tokens[name]])) {
      const ratio = contrast(tokens.faint, background);
      assert.ok(ratio >= 4.5, `${theme} --faint on ${name}: ${ratio.toFixed(2)}:1 (requires 4.5:1)`);
    }

    for (const selector of [".article-tags a", ".article-tags a:nth-child(2n)"]) {
      const foreground = tokenColor(declaration(selector, "color"), tokens);
      const tint = declaration(selector, "background")
        .match(/^color-mix\(in srgb, (var\(--[\w-]+\)) (\d+)%, transparent\)$/);
      assert.ok(tint, `Unexpected tag background for ${selector}`);
      for (const [name, background] of [["paper", tokens.paper], ["surface", tokens.surface]]) {
        const ratio = contrast(foreground, mix(tokenColor(tint[1], tokens), background, Number(tint[2]) / 100));
        assert.ok(ratio >= 4.5, `${theme} ${selector} on ${name}: ${ratio.toFixed(2)}:1 (requires 4.5:1)`);
      }
    }
    for (const selector of [".result-count strong", ".part-link", ".parts-disclosure > summary", ".search-arrival", ".passage-disclosure > summary", ".reader-video-search > summary", ".search-modes label:has(input:checked)"]) {
      const ratio = contrast(tokenColor(declaration(selector, "color"), tokens), tokens.paper);
      assert.ok(ratio >= 4.5, `${theme} ${selector} on paper: ${ratio.toFixed(2)}:1 (requires 4.5:1)`);
    }
    for (const selector of [".passage-link", ".passage-link .passage-action"]) {
      const ratio = contrast(tokenColor(declaration(selector, "color"), tokens), tokens.soft);
      assert.ok(ratio >= 4.5, `${theme} ${selector} on soft: ${ratio.toFixed(2)}:1`);
    }
    const highlight = contrast(tokenColor(declaration("mark", "color"), tokens), tokenColor(declaration("mark", "background"), tokens));
    assert.ok(highlight >= 4.5, `${theme} search highlight contrast: ${highlight.toFixed(2)}:1`);
    const currentNavigation = contrast(tokenColor(declaration(".top-nav a[aria-current]", "color"), tokens), tokenColor(declaration(".top-nav a[aria-current]", "background"), tokens));
    assert.ok(currentNavigation >= 4.5, `${theme} current navigation contrast: ${currentNavigation.toFixed(2)}:1`);
  });
}
