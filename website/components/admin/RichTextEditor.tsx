'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect } from 'react';

/**
 * TipTap-powered WYSIWYG editor. Emits HTML.
 *
 * Keeps a small, hand-picked toolbar (bold/italic/heading/list/link/image)
 * so admins can format content richly without wading through a dozen
 * unused buttons.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 200,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Image.configure({ allowBase64: true, HTMLAttributes: { style: 'max-width:100%;border-radius:12px;margin:12px 0;' } }),
      Placeholder.configure({ placeholder: placeholder || 'Start typing…' }),
    ],
    content: value || '',
    // Fixes the Next.js SSR warning about differing markup on hydration.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        style: `min-height:${minHeight}px;padding:16px;outline:none;font-size:15px;line-height:1.7;color:#0F172A;`,
      },
    },
  });

  // Sync external changes (e.g. loading content from the API) into the
  // editor without wiping the current selection.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
     
  }, [value, editor]);

  if (!editor) return <div style={placeholderStyle}>Loading editor…</div>;

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid ' + (active ? '#14B8A6' : '#CBD5E1'),
    background: active ? '#CCFBF1' : '#FFFFFF',
    color: '#0A2540',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  });

  const addLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL (leave blank to remove)', prev || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const addImage = () => {
    const url = window.prompt('Image URL (paste from Media Library, or full https:// URL)');
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  };

  return (
    <div style={wrap}>
      <div style={toolbar}>
        <button type="button" style={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()}>Bold</button>
        <button type="button" style={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()}>Italic</button>
        <button type="button" style={btn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button type="button" style={btn(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
        <button type="button" style={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
        <button type="button" style={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</button>
        <button type="button" style={btn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>Quote</button>
        <button type="button" style={btn(editor.isActive('link'))} onClick={addLink}>Link</button>
        <button type="button" style={btn(false)} onClick={addImage}>Image</button>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn(false)} onClick={() => editor.chain().focus().undo().run()}>↶</button>
        <button type="button" style={btn(false)} onClick={() => editor.chain().focus().redo().run()}>↷</button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

const wrap: React.CSSProperties = {
  border: '1.5px solid #CBD5E1',
  borderRadius: 14,
  overflow: 'hidden',
  background: '#FFFFFF',
};
const toolbar: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  padding: 10,
  borderBottom: '1px solid #E2E8F0',
  background: '#F8FAFC',
};
const placeholderStyle: React.CSSProperties = {
  padding: 16,
  border: '1.5px solid #CBD5E1',
  borderRadius: 14,
  color: '#94A3B8',
};
