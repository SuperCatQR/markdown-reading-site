// Only validated content-v2 entries enter reader views. Derived keys preserve ID
// case and never modify the frozen catalog.
export const validSourceIdentity = (entry) => entry?.contentVersion === 2
  && ["bilibili", "youtube"].includes(entry.platform)
  && typeof entry.externalVideoId === "string"
  && (entry.platform === "bilibili" ? /^[A-Za-z0-9_-]{1,128}$/ : /^[A-Za-z0-9_-]{11}$/).test(entry.externalVideoId)
  && Number.isSafeInteger(entry.partIndex) && entry.partIndex >= 0
  && (entry.platform !== "youtube" || entry.partIndex === 0);
export const workKey = (entry) => `${entry.platform}.${entry.externalVideoId}`;
export const partIndex = (entry) => entry.partIndex;
export const sourceTags = (entry) => entry.sourceMetadata.tags;
export const platformLabel = (entry) => entry.platform === "youtube" ? "YouTube" : "哔哩哔哩";
export const partLabel = (entry) => entry.platform === "youtube" ? "单视频" : `P${entry.partIndex + 1}`;
export const sourceLabel = (entry) => `${platformLabel(entry)} · ${entry.externalVideoId}`;
export const validWorkKey = (value) => typeof value === "string"
  && /^(?:bilibili\.[A-Za-z0-9_-]{1,128}|youtube\.[A-Za-z0-9_-]{11})$/.test(value);
export const bilibiliId = (entry) => entry.platform === "bilibili" ? entry.externalVideoId : null;

export function videoParameters(key) {
  if (!validWorkKey(key)) throw new Error("Unknown video identity");
  const separator = key.indexOf(".");
  return { platform: key.slice(0, separator), video: key.slice(separator + 1) };
}
