import { FileText, ImagePlus, X, LoaderCircle } from 'lucide-react';
export interface ImageDraft {
  id: string;
  name: string;
  path: string;
  url: string;
  /** 'file' for documents sent as <attached-file>; images omit it. */
  kind?: 'image' | 'file';
  bytes?: number;
}
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\r\n]/g, ' ');
export const imagePrompt = (text: string, images: ImageDraft[] = []) =>
  [
    text.trim() || (images.some((item) => item.kind === 'file') ? '请看一下这个文件。' : '请看一下这张图片。'),
    ...images.map(
      (item) =>
        `<${item.kind === 'file' ? 'attached-file' : 'attached-image'} path="${escape(item.path)}" name="${escape(item.name)}" />`,
    ),
  ].join('\n\n');

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** Documents the assistant can read back (assistant_attachment_read); the native store accepts these types. */
const FILE_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const FILE_MAX = 10 * 1024 * 1024;
export const ATTACH_ACCEPT = [...IMAGE_TYPES, ...Object.keys(FILE_TYPES), ...new Set(Object.values(FILE_TYPES))].join(',');
const extension = (name: string) => (/\.[A-Za-z0-9]+$/.exec(name)?.[0] || '').toLowerCase();

export async function uploadAttachment(file: File): Promise<ImageDraft> {
  return IMAGE_TYPES.includes(file.type) ? uploadImage(file) : uploadFile(file);
}

async function uploadFile(file: File): Promise<ImageDraft> {
  const mime = FILE_TYPES[extension(file.name)];
  if (!mime || !file.size || file.size > FILE_MAX)
    throw new Error('可以添加不超过 10MB 的 PDF、Word（docx）、文本、Markdown、CSV 或 JSON 文件。');
  const id = crypto.randomUUID();
  const response = await fetch(`/api/files?uploadId=${id}&name=${encodeURIComponent(file.name.slice(0, 120))}`, {
    method: 'POST',
    headers: { 'content-type': mime },
    body: file,
  });
  const result = await response.json().catch(() => ({}));
  const filename = String(result.path || '')
    .split(/[\\/]/)
    .at(-1);
  if (!response.ok || !filename || !/^[a-f0-9-]{36}\.(txt|md|csv|tsv|json|pdf|docx)$/.test(filename))
    throw new Error(result.error || '文件暂未添加，原文件没有改变。');
  return { id, name: String(result.name || file.name).slice(0, 120), path: result.path, url: '', kind: 'file', bytes: file.size };
}

export async function uploadImage(file: File): Promise<ImageDraft> {
  if (!IMAGE_TYPES.includes(file.type) || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error('请选择不超过 10MB 的 PNG、JPG 或 WebP 图片。');
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('浏览器无法处理这张图片。');
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const bytes = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('图片读取失败。'))), 'image/png'),
  );
  const id = crypto.randomUUID(),
    response = await fetch('/api/attachments?uploadId=' + id, {
      method: 'POST',
      headers: { 'content-type': bytes.type },
      body: bytes,
    });
  const result = await response.json();
  const filename = String(result.path || '')
    .split(/[\\/]/)
    .at(-1);
  if (!response.ok || !filename || !/^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(filename))
    throw new Error(result.error || '图片暂未添加，原文件没有改变。');
  return { id, name: file.name.slice(0, 120), path: result.path, url: '/api/attachments/' + filename, kind: 'image' };
}

const size = (bytes?: number) =>
  !bytes ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function ImageDrafts({
  images,
  remove,
  uploading,
}: {
  images: ImageDraft[];
  remove(id: string): void;
  uploading: boolean;
}) {
  const pictures = images.filter((item) => item.kind !== 'file');
  return (
    <div className="image-drafts">
      {images.map((item) =>
        item.kind === 'file' ? (
          <span className="file-chip" key={item.id}>
            <FileText size={15} />
            <span className="file-chip-name">{item.name}</span>
            <small>{size(item.bytes)}</small>
            <button type="button" aria-label={'移除文件 ' + item.name} onClick={() => remove(item.id)}>
              <X size={13} />
            </button>
          </span>
        ) : (
          <figure key={item.id}>
            <img src={item.url} alt={item.name} />
            <button type="button" aria-label={'移除图片 ' + item.name} onClick={() => remove(item.id)}>
              <X size={13} />
            </button>
          </figure>
        ),
      )}
      {uploading && (
        <span className="image-uploading">
          <LoaderCircle size={18} className="spin" />
          正在添加
        </span>
      )}
      {pictures.length > 0 && <small>发送后由美国视觉服务识别</small>}
    </div>
  );
}
export function ImagePicker({ add, disabled }: { add(files: File[]): void; disabled: boolean }) {
  return (
    <label className={'attach-image' + (disabled ? ' disabled' : '')} title="添加图片或文件，也可以粘贴或拖入">
      <ImagePlus size={18} />
      <span>图片或文件</span>
      <input
        aria-label="添加图片"
        type="file"
        accept={ATTACH_ACCEPT}
        multiple
        disabled={disabled}
        onChange={(event) => {
          add([...(event.target.files || [])]);
          event.target.value = '';
        }}
      />
    </label>
  );
}
export function MessageImages({ text }: { text: string }) {
  const pictures = [
    ...text.matchAll(
      /<attached-image\s+path="[^"\r\n]*?([a-f0-9-]{36}\.(?:png|jpg|webp|gif))"(?:\s+name="([^"]*)")?\s*\/>/gi,
    ),
  ];
  const files = [...text.matchAll(/<attached-file\s+path="[^"\r\n]*?[a-f0-9-]{36}\.(\w+)"(?:\s+name="([^"]*)")?\s*\/>/gi)];
  return pictures.length || files.length ? (
    <div className="message-images">
      {pictures.map((match) => (
        <a key={match[1]} href={'/api/attachments/' + match[1]} target="_blank" rel="noopener noreferrer">
          <img src={'/api/attachments/' + match[1]} alt={match[2] || '发送的图片'} />
        </a>
      ))}
      {files.map((match, index) => (
        <span className="file-chip sent" key={index + (match[2] || '')}>
          <FileText size={15} />
          <span className="file-chip-name">{unescape(match[2] || '附件.' + match[1])}</span>
        </span>
      ))}
    </div>
  ) : null;
}
const unescape = (text: string) =>
  text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
