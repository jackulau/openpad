import type { Monaco as MonacoNs } from '@monaco-editor/react';
import type * as MonacoEditorTypes from 'monaco-editor';
import type { EditorTheme } from './theme';

type ThemeData = MonacoEditorTypes.editor.IStandaloneThemeData;

const opencoderDark: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#17171a',
    'editor.foreground': '#f4f4f5',
    'editorLineNumber.foreground': '#52525b',
    'editorLineNumber.activeForeground': '#a1a1aa',
    'editor.selectionBackground': '#3b82f655',
    'editor.lineHighlightBackground': '#1e1e22',
    'editorCursor.foreground': '#3b82f6',
    'editorWidget.background': '#1e1e22',
    'editorWidget.border': '#2c2c31',
  },
};

const opencoderLight: ThemeData = {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#18181b',
    'editorLineNumber.foreground': '#a1a1aa',
    'editorLineNumber.activeForeground': '#52525b',
    'editor.selectionBackground': '#2563eb22',
    'editor.lineHighlightBackground': '#f7f7f8',
    'editorCursor.foreground': '#2563eb',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#e4e4e7',
  },
};

const githubDark: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'ffa657' },
    { token: 'function', foreground: 'd2a8ff' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#c9d1d9',
    'editorLineNumber.foreground': '#484f58',
    'editorLineNumber.activeForeground': '#c9d1d9',
    'editor.selectionBackground': '#264f78',
    'editor.lineHighlightBackground': '#161b22',
    'editorCursor.foreground': '#c9d1d9',
  },
};

const githubLight: ThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cf222e' },
    { token: 'string', foreground: '0a3069' },
    { token: 'number', foreground: '0550ae' },
    { token: 'type', foreground: '953800' },
    { token: 'function', foreground: '8250df' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2328',
    'editorLineNumber.foreground': '#8c959f',
    'editorLineNumber.activeForeground': '#1f2328',
    'editor.selectionBackground': '#0969da26',
    'editor.lineHighlightBackground': '#f6f8fa',
    'editorCursor.foreground': '#1f2328',
  },
};

const oneDark: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c678dd' },
    { token: 'string', foreground: '98c379' },
    { token: 'number', foreground: 'd19a66' },
    { token: 'type', foreground: 'e5c07b' },
    { token: 'function', foreground: '61afef' },
    { token: 'variable', foreground: 'e06c75' },
  ],
  colors: {
    'editor.background': '#282c34',
    'editor.foreground': '#abb2bf',
    'editorLineNumber.foreground': '#4b5263',
    'editorLineNumber.activeForeground': '#abb2bf',
    'editor.selectionBackground': '#3e4451',
    'editor.lineHighlightBackground': '#2c313a',
    'editorCursor.foreground': '#528bff',
  },
};

const dracula: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff79c6' },
    { token: 'string', foreground: 'f1fa8c' },
    { token: 'number', foreground: 'bd93f9' },
    { token: 'type', foreground: '8be9fd' },
    { token: 'function', foreground: '50fa7b' },
    { token: 'variable', foreground: 'f8f8f2' },
  ],
  colors: {
    'editor.background': '#282a36',
    'editor.foreground': '#f8f8f2',
    'editorLineNumber.foreground': '#6272a4',
    'editorLineNumber.activeForeground': '#f8f8f2',
    'editor.selectionBackground': '#44475a',
    'editor.lineHighlightBackground': '#313442',
    'editorCursor.foreground': '#f8f8f0',
  },
};

const monokai: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f92672' },
    { token: 'string', foreground: 'e6db74' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'type', foreground: '66d9ef' },
    { token: 'function', foreground: 'a6e22e' },
    { token: 'variable', foreground: 'f8f8f2' },
  ],
  colors: {
    'editor.background': '#272822',
    'editor.foreground': '#f8f8f2',
    'editorLineNumber.foreground': '#75715e',
    'editorLineNumber.activeForeground': '#f8f8f2',
    'editor.selectionBackground': '#49483e',
    'editor.lineHighlightBackground': '#3e3d32',
    'editorCursor.foreground': '#f8f8f0',
  },
};

const nord: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '616e88', fontStyle: 'italic' },
    { token: 'keyword', foreground: '81a1c1' },
    { token: 'string', foreground: 'a3be8c' },
    { token: 'number', foreground: 'b48ead' },
    { token: 'type', foreground: '8fbcbb' },
    { token: 'function', foreground: '88c0d0' },
    { token: 'variable', foreground: 'd8dee9' },
  ],
  colors: {
    'editor.background': '#2e3440',
    'editor.foreground': '#d8dee9',
    'editorLineNumber.foreground': '#4c566a',
    'editorLineNumber.activeForeground': '#d8dee9',
    'editor.selectionBackground': '#434c5e',
    'editor.lineHighlightBackground': '#3b4252',
    'editorCursor.foreground': '#d8dee9',
  },
};

const solarizedDark: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '586e75', fontStyle: 'italic' },
    { token: 'keyword', foreground: '859900' },
    { token: 'string', foreground: '2aa198' },
    { token: 'number', foreground: 'd33682' },
    { token: 'type', foreground: 'b58900' },
    { token: 'function', foreground: '268bd2' },
  ],
  colors: {
    'editor.background': '#002b36',
    'editor.foreground': '#93a1a1',
    'editorLineNumber.foreground': '#586e75',
    'editorLineNumber.activeForeground': '#93a1a1',
    'editor.selectionBackground': '#073642',
    'editor.lineHighlightBackground': '#073642',
    'editorCursor.foreground': '#93a1a1',
  },
};

const solarizedLight: ThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
    { token: 'keyword', foreground: '859900' },
    { token: 'string', foreground: '2aa198' },
    { token: 'number', foreground: 'd33682' },
    { token: 'type', foreground: 'b58900' },
    { token: 'function', foreground: '268bd2' },
  ],
  colors: {
    'editor.background': '#fdf6e3',
    'editor.foreground': '#586e75',
    'editorLineNumber.foreground': '#93a1a1',
    'editorLineNumber.activeForeground': '#586e75',
    'editor.selectionBackground': '#eee8d5',
    'editor.lineHighlightBackground': '#eee8d5',
    'editorCursor.foreground': '#586e75',
  },
};

const REGISTRY: Record<EditorTheme, ThemeData> = {
  'opencoder-dark': opencoderDark,
  'opencoder-light': opencoderLight,
  'github-dark': githubDark,
  'github-light': githubLight,
  'one-dark': oneDark,
  dracula,
  monokai,
  nord,
  'solarized-dark': solarizedDark,
  'solarized-light': solarizedLight,
};

let defined = false;

export function defineMonacoThemes(monaco: MonacoNs): void {
  if (defined) return;
  for (const [id, data] of Object.entries(REGISTRY)) {
    monaco.editor.defineTheme(id, data);
  }
  defined = true;
}

export function applyMonacoTheme(monaco: MonacoNs, id: EditorTheme): void {
  monaco.editor.setTheme(id);
}
