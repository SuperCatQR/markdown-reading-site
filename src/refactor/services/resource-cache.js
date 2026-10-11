export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("操作已取消", "AbortError");
}

// Successful resources only: cancellation and failures never poison retries.
export function createResourceCache(fetchResource = globalThis.fetch, { maxBytes = 32 * 1024 * 1024, maxEntries = 256 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 0) throw new Error("缓存预算无效");
  const completed = new Map();
  let totalBytes = 0;
  const touch = (url, cached) => { completed.delete(url); completed.set(url, cached); };
  const retain = (url, value) => {
    // Count the serialized UTF-16 representation and entry overhead rather than
    // network compression size, which badly understates retained JS memory.
    const bytes = (typeof value === "string" ? value.length : JSON.stringify(value).length) * 2 + 128;
    if (!maxEntries || bytes > maxBytes) return;
    if (completed.has(url)) { totalBytes -= completed.get(url).bytes; completed.delete(url); }
    while (completed.size && (completed.size >= maxEntries || totalBytes + bytes > maxBytes)) {
      const oldest = completed.keys().next().value;
      totalBytes -= completed.get(oldest).bytes;
      completed.delete(oldest);
    }
    completed.set(url, { value, bytes }); totalBytes += bytes;
  };
  return async (url, { signal, text = false, validate = (value) => value } = {}) => {
    throwIfAborted(signal);
    if (!url) throw new Error("资源不在当前快照中");
    if (completed.has(url)) {
      const cached = completed.get(url);
      const value = validate(cached.value);
      throwIfAborted(signal);
      touch(url, cached);
      return value;
    }
    const response = await fetchResource(url, { signal });
    if (!response.ok) throw new Error("资源加载失败，请重试");
    // Response.text() consumes a UTF-8 BOM. Manuscript exports must retain all
    // original UTF-8 bytes, including BOM and CRLF, and reject malformed input.
    const value = validate(await (text
      ? response.arrayBuffer().then((bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))
      : response.json()));
    throwIfAborted(signal);
    retain(url, value);
    return value;
  };
}
