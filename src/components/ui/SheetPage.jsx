import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function SheetPage({ title, children, backTo = -1 }) {
  const navigate = useNavigate();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);

  const handleBack = () => {
    if (typeof backTo === 'string') navigate(backTo);
    else navigate(backTo);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col bg-white dark:bg-zinc-950 w-full h-[100dvh] overflow-hidden">
      <header className="flex items-center h-14 px-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0 bg-white dark:bg-zinc-950">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 transition"
        >
          <i className="fas fa-arrow-left" aria-hidden="true" />
          <span className="text-sm font-medium">Back</span>
        </button>
        {title && (
          <h1 className="ml-4 text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {title}
          </h1>
        )}
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto overflow-y-auto px-4 py-6 md:px-8 md:py-8 pb-[max(24px,env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}

export default SheetPage;
