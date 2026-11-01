// Single byte ranges used by media decoders. Multi-range requests are unsupported.
function mediaRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function cachedMediaResponse(request, response) {
  const header = request.headers.get('range');
  if (!header || !new URL(request.url).pathname.endsWith('.mp4') || response.status !== 200) return response;
  const data = await response.arrayBuffer(), range = mediaRange(header, data.byteLength);
  const headers = new Headers(response.headers); headers.set('Accept-Ranges', 'bytes');
  if (!range) {
    headers.set('Content-Range', `bytes */${data.byteLength}`); headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  const body = data.slice(range.start, range.end + 1);
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${data.byteLength}`);
  headers.set('Content-Length', String(body.byteLength));
  return new Response(body, { status: 206, headers });
}

// CommonJS exports for the server; declarations also work in a classic service worker.
if (typeof module !== "undefined") module.exports = { mediaRange, cachedMediaResponse };
