'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

const BODY_PLACEHOLDER = 'Write the letter. Blank lines start new paragraphs.';
const MAX_BODY_LENGTH = 20000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdownToHtml(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return html;
}

function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return '';
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineMarkdownToHtml(paragraph.join('<br>'))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map(item => `<li>${inlineMarkdownToHtml(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushList();
  flushParagraph();
  return blocks.join('');
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (!(node instanceof HTMLElement)) return '';

  const tag = node.tagName.toLowerCase();
  const inner = Array.from(node.childNodes).map(inlineNodeToMarkdown).join('');
  if (tag === 'strong' || tag === 'b') return inner ? `**${inner}**` : '';
  if (tag === 'em' || tag === 'i') return inner ? `*${inner}*` : '';
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    return href && inner ? `[${inner}](${href})` : inner;
  }
  if (tag === 'br') return '\n';
  return inner;
}

function htmlToMarkdown(root: HTMLElement): string {
  const blocks: string[] = [];
  let inlineBuffer = '';

  const flushInline = () => {
    const clean = inlineBuffer.replace(/\u00a0/g, ' ').trim();
    if (clean) blocks.push(clean);
    inlineBuffer = '';
  };

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      inlineBuffer += node.textContent || '';
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName.toLowerCase();

    if (tag === 'ul' || tag === 'ol') {
      flushInline();
      const items = Array.from(node.children)
        .filter(child => child.tagName.toLowerCase() === 'li')
        .map(child => `- ${Array.from(child.childNodes).map(inlineNodeToMarkdown).join('').replace(/\u00a0/g, ' ').trim()}`)
        .filter(line => line !== '- ');
      if (items.length) blocks.push(items.join('\n'));
      continue;
    }

    if (tag === 'p' || tag === 'div') {
      flushInline();
      const text = Array.from(node.childNodes).map(inlineNodeToMarkdown).join('').replace(/\u00a0/g, ' ').trim();
      if (text) blocks.push(text);
      continue;
    }

    inlineBuffer += inlineNodeToMarkdown(node);
  }

  flushInline();
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function CampaignBodyRichTextEnhancer(): ReactElement | null {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastMarkdownRef = useRef('');
  const syncingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let mountHost: HTMLDivElement | null = null;

    const attach = () => {
      if (cancelled || mountHost) return;
      const textarea = Array.from(document.querySelectorAll('textarea')).find(
        node => node.getAttribute('placeholder') === BODY_PLACEHOLDER,
      ) as HTMLTextAreaElement | undefined;

      if (!textarea) {
        frame = requestAnimationFrame(attach);
        return;
      }

      mountHost = document.createElement('div');
      mountHost.dataset.campaignRichText = '1';
      textarea.parentElement?.insertBefore(mountHost, textarea);
      textarea.style.display = 'none';
      textareaRef.current = textarea;
      lastMarkdownRef.current = textarea.value;
      setHost(mountHost);
    };

    attach();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (textareaRef.current) textareaRef.current.style.display = '';
      mountHost?.remove();
      textareaRef.current = null;
      setHost(null);
    };
  }, []);

  useEffect(() => {
    if (!host) return;
    let frame = 0;
    let cancelled = false;

    const syncFromTextarea = () => {
      if (cancelled) return;
      const textarea = textareaRef.current;
      const editor = editorRef.current;
      if (textarea && editor && document.activeElement !== editor && !syncingRef.current) {
        if (textarea.value !== lastMarkdownRef.current) {
          lastMarkdownRef.current = textarea.value;
          editor.innerHTML = markdownToHtml(textarea.value);
        }
      }
      frame = requestAnimationFrame(syncFromTextarea);
    };

    frame = requestAnimationFrame(syncFromTextarea);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [host]);

  if (!host) return null;

  const syncToTextarea = () => {
    const textarea = textareaRef.current;
    const editor = editorRef.current;
    if (!textarea || !editor) return;
    const markdown = htmlToMarkdown(editor);
    if (markdown.length > MAX_BODY_LENGTH) {
      editor.innerHTML = markdownToHtml(lastMarkdownRef.current);
      return;
    }
    lastMarkdownRef.current = markdown;
    syncingRef.current = true;
    setNativeTextareaValue(textarea, markdown);
    syncingRef.current = false;
  };

  const runCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncToTextarea();
  };

  const addLink = () => {
    const selection = window.getSelection();
    const savedRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const href = window.prompt('Link URL (https://…)');
    if (!href) return;
    if (!/^https?:\/\//i.test(href.trim())) return;
    editorRef.current?.focus();
    if (selection && savedRange) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    document.execCommand('createLink', false, href.trim());
    syncToTextarea();
  };

  const toolbarButton = {
    border: '1px solid #CBD5E1',
    background: '#FFFFFF',
    color: '#0A2540',
    borderRadius: 8,
    minWidth: 34,
    height: 32,
    padding: '0 9px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  } as const;

  return createPortal(
    <div style={{ border: '1.5px solid #CBD5E1', borderRadius: 12, overflow: 'hidden', background: '#FFFFFF' }}>
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', padding: 8,
        borderBottom: '1px solid #E2E8F0', background: '#F8FAFC',
      }}>
        <button type="button" title="Bold" aria-label="Bold"
          onMouseDown={e => { e.preventDefault(); runCommand('bold'); }} style={toolbarButton}><strong>B</strong></button>
        <button type="button" title="Italic" aria-label="Italic"
          onMouseDown={e => { e.preventDefault(); runCommand('italic'); }} style={{ ...toolbarButton, fontStyle: 'italic' }}>I</button>
        <button type="button" title="Add link" aria-label="Add link"
          onMouseDown={e => { e.preventDefault(); addLink(); }} style={toolbarButton}>🔗</button>
        <button type="button" title="Bulleted list" aria-label="Bulleted list"
          onMouseDown={e => { e.preventDefault(); runCommand('insertUnorderedList'); }} style={{ ...toolbarButton, minWidth: 70 }}>• Bullets</button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-testid="campaign-body-rich-editor"
        onInput={syncToTextarea}
        onBlur={syncToTextarea}
        style={{
          minHeight: 180, padding: '11px 12px', outline: 'none',
          fontSize: 14, lineHeight: 1.6, color: '#0F172A', whiteSpace: 'normal',
        }}
        dangerouslySetInnerHTML={{ __html: markdownToHtml(lastMarkdownRef.current) }}
      />
      <div style={{ padding: '6px 10px', borderTop: '1px solid #F1F5F9', fontSize: 11, color: '#64748B' }}>
        Paste formatted text or use Bold, Italic, Links and Bullets. Blank lines keep paragraph spacing.
      </div>
    </div>,
    host,
  ) as unknown as ReactElement;
}
