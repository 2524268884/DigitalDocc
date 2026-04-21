'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect } from 'react';

const DESKTOP_STORAGE_KEY = 'docs-sidebar-scroll-top';
const MOBILE_STORAGE_KEY = 'docs-sidebar-mobile-scroll-top';
const MAX_RESTORE_ATTEMPTS = 10;

function getSidebarViewport(sidebarId: string): HTMLElement | null {
  const sidebar = document.getElementById(sidebarId);
  if (!sidebar) return null;

  return sidebar.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
}

function restoreScrollPosition(sidebarId: string, storageKey: string): void {
  const savedValue = window.sessionStorage.getItem(storageKey);
  if (!savedValue) return;

  const targetScrollTop = Number(savedValue);
  if (Number.isNaN(targetScrollTop)) return;

  let attempts = 0;

  const apply = () => {
    const viewport = getSidebarViewport(sidebarId);
    if (viewport) {
      viewport.scrollTop = targetScrollTop;
      return;
    }

    if (attempts >= MAX_RESTORE_ATTEMPTS) return;
    attempts += 1;
    window.requestAnimationFrame(apply);
  };

  apply();
}

function bindScrollPersistence(sidebarId: string, storageKey: string): (() => void) | null {
  const viewport = getSidebarViewport(sidebarId);
  if (!viewport) return null;

  const persist = () => {
    window.sessionStorage.setItem(storageKey, String(viewport.scrollTop));
  };

  viewport.addEventListener('scroll', persist, { passive: true });

  return () => {
    persist();
    viewport.removeEventListener('scroll', persist);
  };
}

export function SidebarScrollRestoration() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    restoreScrollPosition('nd-sidebar', DESKTOP_STORAGE_KEY);
    restoreScrollPosition('nd-sidebar-mobile', MOBILE_STORAGE_KEY);

    let attempt = 0;
    let frameId = 0;
    let cleanups: Array<() => void> = [];

    const connect = () => {
      cleanups = [
        bindScrollPersistence('nd-sidebar', DESKTOP_STORAGE_KEY),
        bindScrollPersistence('nd-sidebar-mobile', MOBILE_STORAGE_KEY),
      ].filter((cleanup): cleanup is () => void => cleanup !== null);

      if (cleanups.length > 0 || attempt >= MAX_RESTORE_ATTEMPTS) return;

      attempt += 1;
      frameId = window.requestAnimationFrame(connect);
    };

    connect();

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [pathname]);

  return null;
}
