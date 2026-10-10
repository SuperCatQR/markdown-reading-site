// Catalog identity stays intact; work keys are only for grouping and navigation.
export const workKey = (entry) => entry.contentVersion === 2
  ? `${entry.platform}.${entry.externalVideoId}` : entry.bvid;
export const partIndex = (entry) => entry.contentVersion === 2 ? entry.partIndex : entry.pageIndex;
export const sourceLabel = (entry) => entry.contentVersion === 2
  ? `${entry.platform === "youtube" ? "YouTube" : "哔哩哔哩"} · ${entry.externalVideoId}` : entry.bvid;
export const validWorkKey = (value) => typeof value === "string"
  && /^(?:[\w-]{1,80}|(?:bilibili|youtube)\.[A-Za-z0-9_-]{1,128})$/.test(value);
export const bilibiliId = (entry) => entry.contentVersion === 2
  ? entry.platform === "bilibili" ? entry.externalVideoId : null : entry.bvid;
