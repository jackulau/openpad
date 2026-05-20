import { useEffect, useRef } from 'react';
import Monaco, { type Monaco as MonacoNs, type OnMount } from '@monaco-editor/react';
import type * as MonacoEditorTypes from 'monaco-editor';
import { useTheme } from '../lib/theme';
import { applyMonacoTheme, defineMonacoThemes } from '../lib/monaco-themes';

export interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  cursor: { line: number; column: number };
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface EditorProps {
  value: string;
  onChange?: (v: string) => void;
  language: string;
  readOnly?: boolean;
  onMount?: (editor: MonacoEditorTypes.editor.IStandaloneCodeEditor, monaco: MonacoNs) => void;
  height?: number | string;
  remoteCursors?: RemoteCursor[];
}

// Sanitize a userId into a CSS-class-safe suffix so per-user style rules don't
// break with UUID dashes or unusual chars.
function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function Editor({
  value,
  onChange,
  language,
  readOnly,
  onMount,
  height = '100%',
  remoteCursors,
}: EditorProps) {
  const editorRef = useRef<MonacoEditorTypes.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const widgetsRef = useRef<Map<string, MonacoEditorTypes.editor.IContentWidget>>(new Map());
  const styleTagRef = useRef<HTMLStyleElement | null>(null);
  const { editorTheme } = useTheme();

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    defineMonacoThemes(monaco);
    applyMonacoTheme(monaco, editorTheme);
    onMount?.(editor, monaco);
  };

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    applyMonacoTheme(monaco, editorTheme);
  }, [editorTheme]);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.getValue() !== value) {
      editorRef.current.setValue(value);
    }
  }, [value]);

  // Paint remote cursors + selections as Monaco decorations, with a content
  // widget per user that floats their name label above the caret. Per-user
  // colors get inlined into a shared <style> tag because Monaco decorations
  // can't carry inline styles directly - only className references.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const cursors = remoteCursors ?? [];

    // Inject / refresh per-user color rules.
    if (!styleTagRef.current) {
      const el = document.createElement('style');
      el.dataset.oc = 'collab-cursors';
      document.head.appendChild(el);
      styleTagRef.current = el;
    }
    const css = cursors
      .map((c) => {
        const id = cssId(c.userId);
        const color = c.color;
        return [
          `.oc-collab-caret-${id} { border-left: 2px solid ${color}; }`,
          `.oc-collab-selection-${id} { background-color: ${color}; }`,
          `.oc-collab-label-${id} { background-color: ${color}; }`,
        ].join('\n');
      })
      .join('\n');
    styleTagRef.current.textContent = css;

    // Build decorations: caret (zero-width) + optional selection range.
    const decorations: MonacoEditorTypes.editor.IModelDeltaDecoration[] = [];
    for (const c of cursors) {
      const id = cssId(c.userId);
      decorations.push({
        range: new monaco.Range(
          c.cursor.line,
          c.cursor.column,
          c.cursor.line,
          c.cursor.column,
        ),
        options: {
          className: `oc-collab-caret oc-collab-caret-${id}`,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
      if (
        c.selection &&
        !(
          c.selection.startLine === c.selection.endLine &&
          c.selection.startColumn === c.selection.endColumn
        )
      ) {
        decorations.push({
          range: new monaco.Range(
            c.selection.startLine,
            c.selection.startColumn,
            c.selection.endLine,
            c.selection.endColumn,
          ),
          options: {
            className: `oc-collab-selection oc-collab-selection-${id}`,
          },
        });
      }
    }
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);

    // Sync name-label content widgets. Reconcile keyed by userId so widgets
    // persist (cheaper than tearing down + recreating on every cursor move).
    const wanted = new Set(cursors.map((c) => c.userId));
    for (const [uid, widget] of widgetsRef.current) {
      if (!wanted.has(uid)) {
        editor.removeContentWidget(widget);
        widgetsRef.current.delete(uid);
      }
    }
    for (const c of cursors) {
      let w = widgetsRef.current.get(c.userId);
      if (!w) {
        const node = document.createElement('div');
        node.className = `oc-collab-label oc-collab-label-${cssId(c.userId)}`;
        node.textContent = c.name;
        w = {
          getId: () => `oc-collab-${c.userId}`,
          getDomNode: () => node,
          getPosition: () => ({
            position: { lineNumber: c.cursor.line, column: c.cursor.column },
            preference: [
              monaco.editor.ContentWidgetPositionPreference.ABOVE,
              monaco.editor.ContentWidgetPositionPreference.BELOW,
            ],
          }),
        };
        editor.addContentWidget(w);
        widgetsRef.current.set(c.userId, w);
      } else {
        const node = w.getDomNode();
        if (node.textContent !== c.name) node.textContent = c.name;
        w.getPosition = () => ({
          position: { lineNumber: c.cursor.line, column: c.cursor.column },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        });
        editor.layoutContentWidget(w);
      }
    }
  }, [remoteCursors]);

  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor) {
        editor.deltaDecorations(decorationsRef.current, []);
        for (const widget of widgetsRef.current.values()) {
          editor.removeContentWidget(widget);
        }
      }
      widgetsRef.current.clear();
      if (styleTagRef.current) {
        styleTagRef.current.remove();
        styleTagRef.current = null;
      }
    };
  }, []);

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
        padding: { top: 12, bottom: 12 },
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      }}
    />
  );
}
