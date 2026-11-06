import { createRequire } from 'node:module';
const require = createRequire(new URL('../app/package.json', import.meta.url));
// A disposable parser process receives bytes only, no user paths or credentials.
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 14500000) throw new Error('Document too large'); }
try {
  const { extension, data } = JSON.parse(input), buffer = Buffer.from(data, 'base64'); let text;
  if (extension === '.docx') text = (await require('mammoth').extractRawText({ buffer })).value;
  else if (extension === '.pdf') {
    const { PDFParse } = require('pdf-parse'); const parser = new PDFParse({ data: buffer });
    try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
  } else throw new Error('Unsupported document');
  process.stdout.write(JSON.stringify({ text: text.slice(0, 50000), truncated: text.length > 50000 }));
} catch { process.stdout.write(JSON.stringify({ error: '文档无法解析；加密文件或扫描件需要先解密或 OCR。' })); process.exitCode = 1; }
