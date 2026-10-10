import { readFile, writeFile } from "node:fs/promises";

const filename = process.argv[2] || ".tmp/global-search-performance.log";
const content = await readFile(filename, "utf8");
const start = content.indexOf("### Result\n") >= 0 ? content.indexOf("### Result\n") + "### Result\n".length : content.indexOf("### Result\r\n") + "### Result\r\n".length;
if (start < 10) throw Error("No browser result found");
const report = JSON.parse(content.slice(start, content.indexOf("\n### Ran", start)).trim());
const groups = new Map();
for (const sample of report.samples) {
  const key = `${sample.network}/${sample.strategy}/${sample.temperature}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(sample);
}
const rows = [...groups].map(([group, samples]) => {
  const times = samples.map((sample) => sample.inputToResultMs).sort((a, b) => a - b);
  const stages = {};
  for (const name of new Set(samples.flatMap((sample) => sample.stages.map((stage) => stage.name)))) {
    const totals = samples.map((sample) => sample.stages.filter((stage) => stage.name === name).reduce((sum, stage) => sum + stage.duration, 0)).sort((a, b) => a - b);
    stages[name] = totals[Math.floor(totals.length / 2)];
  }
  return { group, count: samples.length, inputToResultMs: { min: times[0], median: times[Math.floor(times.length / 2)], max: times.at(-1) }, bytes: samples[0].bytes,
    requestCount: samples[0].resources.length, retainedHeapAfterGC: samples.map((sample) => sample.heap.retainedAfterGC), stages };
});
const summary = { userAgent: report.userAgent, note: report.note, rows, errors: report.errors };
await writeFile(".tmp/global-search-performance.json", JSON.stringify(report, null, 2) + "\n");
await writeFile(".tmp/global-search-performance-summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
