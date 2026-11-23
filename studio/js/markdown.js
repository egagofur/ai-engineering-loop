import { escapeHtml } from './list.js';

const HEADING_TAGS = ['h4', 'h5', 'h6', 'h6', 'h6', 'h6'];
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const SAFE_URL = /^https?:\/\/[^\s]+$/i;

function unescapeUrl(value) {
  return value.replaceAll('&amp;', '&');
}

function inlineCode(text, slots) {
  return text.replace(/`([^`]+)`/g, (match, code) => {
    slots.push(`<code>${code}</code>`);
    return `\u0000${slots.length - 1}\u0000`;
  });
}

function links(text, slots) {
  return text.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (match, label, href) => {
    const url = unescapeUrl(href);
    if (!SAFE_URL.test(url)) return label;
    slots.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    return `\u0000${slots.length - 1}\u0000`;
  });
}

function emphasis(text) {
  return text
    .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
}

export function renderInline(raw) {
  const slots = [];
  let text = escapeHtml(raw);
  text = inlineCode(text, slots);
  text = links(text, slots);
  text = emphasis(text);
  return text.replace(/\u0000(\d+)\u0000/g, (match, index) => slots[Number(index)]);
}

function indentOf(spaces) {
  return spaces.replaceAll('\t', '    ').length;
}

function renderList(lines, start) {
  const first = lines[start].match(LIST_ITEM);
  const base = indentOf(first[1]);
  const tag = /\d/.test(first[2]) ? 'ol' : 'ul';
  const items = [];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(LIST_ITEM);
    if (!match) break;
    const indent = indentOf(match[1]);
    if (indent < base) break;
    if (indent > base && items.length) {
      const nested = renderList(lines, index);
      items[items.length - 1] += nested.html;
      index = nested.next;
      continue;
    }
    items.push(renderInline(match[3]));
    index += 1;
  }
  return { html: `<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`, next: index };
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (FENCE.test(line)) {
      flush();
      const fence = line.trim().slice(0, 3);
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence)) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      index += 1;
      continue;
    }
    if (!line.trim()) {
      flush();
      index += 1;
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const tag = HEADING_TAGS[heading[1].length - 1];
      blocks.push(`<${tag}>${renderInline(heading[2])}</${tag}>`);
      index += 1;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const list = renderList(lines, index);
      blocks.push(list.html);
      index = list.next;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flush();
  return blocks.join('');
}
