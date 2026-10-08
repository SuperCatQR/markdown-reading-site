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

for (const [theme, selector] of [["light", ":root"], ["dark", ':root[data-theme="dark"]']]) {
  test(`${theme} auxiliary text meets AA on its backgrounds`, () => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `Missing ${theme} theme`);
    const block = css.slice(start, css.indexOf("}", start));
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)]
      .map(([, name, value]) => [name, rgb(value)]));
    const hover = tokens.surface.map((channel, index) => channel * 0.88 + tokens["accent-soft"][index] * 0.12);
    for (const [name, background] of [...["paper", "surface", "soft"].map((name) => [name, tokens[name]]), ["article hover", hover]]) {
      const ratio = contrast(tokens.faint, background);
      assert.ok(ratio >= 4.5, `${theme} --faint on ${name}: ${ratio.toFixed(2)}:1 (requires 4.5:1)`);
    }
  });
}
