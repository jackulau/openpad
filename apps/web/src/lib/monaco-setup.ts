import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Self-host Monaco instead of the @monaco-editor/react default, which fetches the
// AMD loader from cdn.jsdelivr.net at runtime. In production the API serves the
// SPA under a strict CSP (script-src 'self' blob:), so that CDN request is blocked
// and the editor never initializes ("Loading…" forever). Wiring the bundled
// monaco + its web workers keeps everything same-origin — workers instantiate as
// blob: URLs, which the CSP already allows — so the editor works offline/air-gapped
// and is pinned to the exact monaco-editor version that y-monaco binds against
// (the CDN default served a different version, a latent instance mismatch).
//
// Each `?worker` import is emitted as its own lazy chunk, so a language worker is
// only fetched when that language is actually edited; the base editor.worker is
// the fallback every language uses.
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

loader.config({ monaco });
