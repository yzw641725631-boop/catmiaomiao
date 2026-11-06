import { createHash } from 'node:crypto';

const OBSERVATIONS = new Set(['get_window_state', 'get_desktop_state', 'get_browser_state', 'list_windows', 'agent_browser_snapshot', 'agent_browser_status', 'agent_browser_read']);
const VOLATILE = new Set(['snapshot_id', 'snapshotId', 'element_token', 'elementToken', 'at', 'timestamp', 'screenshot', 'screenshot_data', 'screenshot_base64']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function metadata(text) {
  const records = [];
  const visit = (value, depth = 0) => {
    if (depth > 4) return;
    if (typeof value === 'string') {
      if (value.length > 100000) return;
      try { visit(JSON.parse(value), depth + 1); return; } catch {}
      for (const line of value.split('\n').slice(-5)) {
        try { const row = JSON.parse(line); if (object(row)) visit(row, depth + 1); } catch {}
      }
    } else if (object(value)) {
      records.push(value);
      if ('result' in value) visit(value.result, depth + 1);
    }
  };
  visit(text);
  return records;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !VOLATILE.has(key)).map(key => [key, stable(value[key])]));
}

function fingerprint(result) {
  const records = metadata(result.text);
  const state = records.findLast(row => Array.isArray(row.elements) || Array.isArray(row.windows));
  const view = state ? { pid: state.pid, window_id: state.window_id, app_name: state.app_name, elements: state.elements, windows: state.windows }
    : result.text.replace(/"(?:snapshot_id|element_token)"\s*:\s*"[^"\n]*"/g, '"snapshot":"volatile"');
  const hash = createHash('sha256').update(JSON.stringify(stable(view)));
  for (const image of result.images || []) hash.update(image.image_url?.url || '');
  return hash.digest('hex');
}

function nativeFailure(result) {
  const rows = metadata(result.text);
  const refusal = rows.find(row => row.status === 'refused' || object(row.refusal));
  const unavailable = rows.find(row => row.code === 'background_unavailable' && row.escalation?.recommended === 'foreground');
  return { refusal, unavailable, failed: result.ok === false || rows.some(row => row.ok === false || row.status === 'refused' || object(row.refusal)) };
}

export class ToolRecovery {
  constructor({ allowForeground = () => false, observationLimit = 4 } = {}) {
    this.allowForeground = allowForeground;
    this.observationLimit = observationLimit;
    this.observations = new Map();
    this.stopped = false;
  }

  async execute(tool, args, signal, run) {
    signal.throwIfAborted();
    if (this.stopped) throw new Error('电脑操作连续未取得进展，已暂停本轮。请核对页面后继续。');
    const native = tool.hostComputer === true || tool.builtInBrowser === true;
    let result = await run(args);
    signal.throwIfAborted();
    if (!native) return result;
    let failure = nativeFailure(result);
    // CUA's explicit background_unavailable means the keystroke was not delivered.
    // Unknown failures and operations that may have taken effect are never replayed.
    if (tool.hostComputer === true && tool.server === 'computer' && tool.name === 'press_key'
      && failure.unavailable && args.delivery_mode !== 'foreground' && this.allowForeground()) {
      signal.throwIfAborted();
      result = await run({ ...args, delivery_mode: 'foreground' });
      signal.throwIfAborted();
      failure = nativeFailure(result);
      result = { ...result, text: '后台按键未送达，已按驱动提示以前台方式补试一次。\n' + result.text };
    }
    if (failure.failed || failure.refusal || failure.unavailable) {
      result = { ...result, ok: false, ...(failure.refusal ? { text: result.text + '\n浏览器访问被拒绝，尚未取得页面状态。请完成所需授权，或使用已获允许的界面工具；不要重复相同的拒绝请求。' } : {}) };
    }
    if (!OBSERVATIONS.has(tool.name)) {
      if (result.ok) this.observations.clear();
      return result;
    }
    const key = JSON.stringify([tool.server, tool.name, stable(Object.fromEntries(Object.entries(args).filter(([name]) => !['include_screenshot', 'capture_mode', 'snapshot_id'].includes(name))))]);
    const hash = fingerprint(result), prior = this.observations.get(key);
    const count = prior?.hash === hash ? prior.count + 1 : 1;
    this.observations.set(key, { hash, count });
    if (count >= this.observationLimit) {
      this.stopped = true;
      throw new Error(`连续 ${count} 次读取相同的电脑或浏览器状态，没有观察到进展，已暂停本轮。请检查此前失败的输入或页面跳转，再继续任务。`);
    }
    if (count === this.observationLimit - 1) return { ...result, text: result.text + '\n已连续多次读取相同状态。请修正失败的操作或切换有效观察范围；再次空转将暂停本轮。' };
    return result;
  }
}
