import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md card p-8 space-y-6">
        <div>
          <Link to="/" className="text-brand-400 text-sm font-medium">
            ← opencoder
          </Link>
          <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}
