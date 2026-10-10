async (page) => {
  const catalog = await page.evaluate(async () => {
    const asset = performance.getEntriesByType("resource").find((resource) => resource.name.includes("/reader-catalog-")).name;
    const module = await import(asset);
    return Object.values(module).find((value) => value?.articles?.some((entry) => entry.manuscriptType === "publication-draft"));
  });
  const ordered = [...catalog.articles].sort((a, b) => b.title.length - a.title.length);
  const latest = ordered[0], older = ordered.find((entry) => entry.videoPartId !== latest.videoPartId);
  const record = (entry, ago = 0) => ({
    id: `${entry.manuscriptType}:${entry.videoPartId}`, manuscriptType: entry.manuscriptType, videoPartId: entry.videoPartId,
    contentVersion: 2, platform: entry.platform, externalVideoId: entry.externalVideoId, partIndex: entry.partIndex, editionId: entry.editionId, contentSha256: entry.contentSha256,
    artifactSha256: entry.artifactSha256, releaseId: null, title: entry.title, readingMode: "single", documentMode: "body",
    anchor: "passage-1", offset: 0, text: "", lastReadAt: Date.now() - ago,
  });
  const seed = (records) => ({ schemaVersion: 2, records, deleted: {}, clearedAt: 0 });
  const base = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const target = await context.newPage(), errors = [];
  target.on("pageerror", (error) => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const load = async (value) => {
    await target.goto(`${base}?view=all`);
    await target.evaluate((value) => localStorage.setItem("reader-history-v2", typeof value === "string" ? value : JSON.stringify(value)), value);
    await target.reload();
    await target.locator(".recent-reading").waitFor();
  };
  try {
    await load(seed([record(latest), record(older, 1000)]));
    const title = target.locator(".recent-reading-title > summary");
    assert(await title.locator("strong").textContent() === latest.title, "Full title was modified");
    assert(!await target.locator(".recent-reading-title").evaluate((node) => node.open), "Title initially expanded");
    const geometry = await target.evaluate(() => ({
      height: document.querySelector(".recent-reading").getBoundingClientRect().height,
      firstTitle: document.querySelector(".video-heading h2").getBoundingClientRect().top,
      resume: document.querySelector(".recent-reading-primary > a").getBoundingClientRect().toJSON(),
      management: document.querySelector(".recent-reading-management > summary").getBoundingClientRect().toJSON(),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert(geometry.height <= 130, `Mobile recent area too tall: ${geometry.height}`);
    assert(geometry.firstTitle < 685, `First directory title displaced: ${geometry.firstTitle}`);
    assert(Math.abs(geometry.resume.y - geometry.management.y) < 3, "Actions are not aligned in one row");
    assert(geometry.resume.height >= 44 && geometry.management.height >= 44 && !geometry.overflow, "Touch targets or overflow invalid");
    await title.focus(); await target.keyboard.press("Enter");
    assert(await target.locator(".recent-reading-title").evaluate((node) => node.open), "Keyboard cannot expand title");
    assert(await title.locator("strong").evaluate((node) => node.clientHeight >= node.scrollHeight - 1), "Expanded title still clipped");
    await target.keyboard.press("Enter");
    await target.screenshot({ path: "artifacts/third-recent-mobile.png" });
    await target.locator(".recent-reading-primary [data-reading-resume]").click();
    await target.locator("article[data-edition] .prose").waitFor();
    assert(target.url().includes(`draft=${latest.editionId}`), "Direct resume opens wrong edition");
    await load(seed([record(latest), record(older, 1000)]));
    await target.locator(".recent-reading-management > summary").click();
    assert(await target.locator(".recent-reading-management li").count() === 2, "Older records inaccessible");
    await target.locator(".recent-reading-management [data-reading-delete]").last().click();
    assert(await target.locator(".recent-reading-management li").count() === 1, "Deletion failed");
    await target.locator("[data-reading-clear]").click();
    assert(await target.locator(".recent-reading").count() === 0, "Clear failed");
    await load(seed([{ ...record(latest), artifactSha256: "f".repeat(64) }, record(older, 1000)]));
    assert((await target.locator(".recent-reading-primary").textContent()).includes("内容已更新"), "Updated latest status missing");
    assert(await target.locator(".recent-reading-primary [data-reading-resume]").count() === 0, "Updated record retained stale anchor");
    await load(seed([{ ...record(latest), videoPartId: 9999999, id: "publication-draft:9999999" }, record(older, 1000)]));
    assert((await target.locator(".recent-reading-primary").textContent()).includes("稿件已撤回"), "Withdrawn latest was silently promoted");
    await load("{invalid-json");
    assert((await target.locator(".recent-reading").textContent()).includes("已损坏"), "Corrupt storage notice hidden");
    assert(await target.locator(".recent-reading-management").evaluate((node) => node.open), "Recovery management hidden");
    await target.locator("[data-reading-clear]").click();
    assert(await target.locator(".recent-reading").count() === 0, "Corrupt recovery failed");
    await load(seed([record(latest), record(older, 1000)]));
    await target.setViewportSize({ width: 1440, height: 1000 });
    assert(await target.locator(".recent-reading-title strong").evaluate((node) => node.clientHeight >= node.scrollHeight - 1), "Desktop title clipped");
    await target.emulateMedia({ colorScheme: "dark" });
    await target.screenshot({ path: "artifacts/third-recent-desktop-dark.png" });
    assert(errors.length === 0, errors.join("; "));
    return { passed: true, titleLength: latest.title.length, geometry, checks: ["compact 390px", "full accessible title and keyboard expansion", "direct resume", "older/deletion/clear", "updated/withdrawn latest", "corrupt recovery", "desktop and dark theme"] };
  } finally { await context.close(); }
}
