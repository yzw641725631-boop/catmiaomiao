export const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

export function validatedEndpoint(raw, fullPath = false) {
  let url;
  try { url = new URL(raw); } catch { throw fail('请填写有效的服务地址。'); }
  if (url.username || url.password || url.hash || url.search || !['http:', 'https:'].includes(url.protocol)) throw fail('服务地址不能包含凭据、查询参数或片段。');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw fail('非本机服务请使用 HTTPS 地址。');
  if (!fullPath && /\/chat\/completions\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '');
  return url.toString().replace(/\/$/, '');
}

export function reachaiOrigin(raw) {
  const address = validatedEndpoint(raw, true);
  const url = new URL(address);
  if (url.pathname !== '/') throw fail('Saturn Cloud 请填写平台根地址，不附加 /model 或 /v1。');
  return url.origin;
}
