import { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getToken } from '../lib/api';

// Loads a problem asset with the bearer token and renders it as a blob URL.
// Only same-origin /api/ assets and data: URLs are fetched; anything external is
// left unrendered (CSP blocks it anyway) so a pasted markdown image can't beacon
// out to a third party.
function AssetImage({ src, alt }: { src: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isDataUrl = src.startsWith('data:');
  const isLocalAsset = src.startsWith('/api/');

  useEffect(() => {
    if (isDataUrl || !isLocalAsset) return;
    let revoked = false;
    let objUrl: string | null = null;
    const token = getToken();
    fetch(src, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        if (revoked) return;
        objUrl = URL.createObjectURL(blob);
        setBlobUrl(objUrl);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [src, isDataUrl, isLocalAsset]);

  if (isDataUrl) {
    return <img src={src} alt={alt} className="max-w-full rounded-md border border-line my-2" />;
  }
  if (!isLocalAsset || failed) {
    return <span className="text-xs text-subtle italic">[image: {alt || src}]</span>;
  }
  if (!blobUrl) {
    return <span className="text-xs text-subtle">loading image…</span>;
  }
  return <img src={blobUrl} alt={alt} className="max-w-full rounded-md border border-line my-2" />;
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-lg font-semibold text-primary mt-4 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold text-primary mt-4 mb-2 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-primary mt-3 mb-1.5">{children}</h3>,
  p: ({ children }) => <p className="text-sm text-secondary leading-relaxed my-2">{children}</p>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 my-2 text-sm text-secondary space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2 text-sm text-secondary space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-line-strong pl-3 my-2 text-sm text-subtle italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-line" />,
  strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-elevated border border-line p-3 text-xs font-mono my-2 leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className ?? '');
    return isBlock ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono text-primary">{children}</code>
    );
  },
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-line px-2 py-1 text-left font-semibold text-primary">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1 text-secondary">{children}</td>,
  img: ({ src, alt }) => <AssetImage src={typeof src === 'string' ? src : ''} alt={alt ?? ''} />,
};

// Renders trusted-but-user-authored markdown. react-markdown escapes raw HTML by
// default (no rehype-raw here), so there is no HTML-injection surface.
export function MarkdownView({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-sm text-subtle italic">No description yet.</p>;
  }
  return (
    <div className="max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
