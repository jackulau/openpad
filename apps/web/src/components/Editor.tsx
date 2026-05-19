import { useEffect, useRef } from 'react';
import Monaco, { type Monaco as MonacoNs, type OnMount } from '@monaco-editor/react';
import type * as MonacoEditorTypes from 'monaco-editor';

export interface EditorProps {
  value: string;
  onChange?: (v: string) => void;
  language: string;
  readOnly?: boolean;
  onMount?: (editor: MonacoEditorTypes.editor.IStandaloneCodeEditor, monaco: MonacoNs) => void;
  height?: number | string;
}

export function Editor({
  value,
  onChange,
  language,
  readOnly,
  onMount,
  height = '100%',
}: EditorProps) {
  const editorRef = useRef<MonacoEditorTypes.editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monaco.editor.defineTheme('opencoder-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0a0a0b',
      },
    });
    monaco.editor.setTheme('opencoder-dark');
    onMount?.(editor, monaco);
  };

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.getValue() !== value) {
      editorRef.current.setValue(value);
    }
  }, [value]);

  return (
    <Monaco
      height={height}
      language={language}
      defaultValue={value}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={handleMount}
      options={{
        readOnly,
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        automaticLayout: true,
        wordWrap: 'on',
        renderWhitespace: 'selection',
        tabSize: 2,
        fontLigatures: true,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      }}
    />
  );
}
