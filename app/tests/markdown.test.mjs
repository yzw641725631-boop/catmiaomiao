import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { MessageMarkdown } from '../src/MessageMarkdown.ts';
const render = text => renderToStaticMarkup(createElement(MessageMarkdown, { text, threadId: 'work', messageId: 'reply' }));

test('the actual acceptance summary renders GFM as a table and keeps fenced source as code', () => {
  const record = JSON.parse(readFileSync(new URL('../../evidence/windows-files-20261022/real-work-2026-10-22T10-06-04-356Z.json', import.meta.url), 'utf8'));
  const html = render(record.finalReply);
  assert.match(html, /<table>/); assert.match(html, /<th>项目<\/th>/); assert.match(html, /<td>.*检索助理/s); assert.match(html, /markdown-table/);
  assert.match(html, /<pre><code class="language-markdown">/); assert.match(html, /class="file-link"/);
  assert(!html.includes('|---|---|---|'));
});
test('GFM checklists and strike-through work without executing HTML or unsafe links', () => {
  const html = render('- [x] 已完成\n- [ ] 待完成\n\n~~旧结论~~\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))');
  assert.match(html, /type="checkbox"/); assert.match(html, /disabled=""/); assert.match(html, /<del>旧结论<\/del>/);
  assert(!html.includes('<script>')); assert(!html.includes('href="javascript:')); assert(!html.includes('onclick='));
});
