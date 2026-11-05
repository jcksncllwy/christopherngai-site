"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "theme-dark";

// The theme lives on <html class="dark"> (set pre-paint by the script in
// layout.tsx), so subscribe to class changes on the root element. Also follow
// the OS setting until the user picks a theme explicitly.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = (e: MediaQueryListEvent) => {
    if (localStorage.getItem(STORAGE_KEY) === null) {
      document.documentElement.classList.toggle("dark", e.matches);
    }
  };
  media.addEventListener("change", onMedia);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onMedia);
  };
}
const getIsDark = () => document.documentElement.classList.contains("dark");
const getIsDarkServer = () => false;

// true after hydration, false during SSR: avoids rendering the wrong icon.
const noopSubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getIsDark, getIsDarkServer);
  const mounted = useMounted();

  const toggle = useCallback(() => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }, [isDark]);

  if (!mounted) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      className="fixed bottom-4 right-4 z-50 p-2 rounded-full text-ink/60 hover:text-ink transition-colors duration-300 cursor-pointer"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
    </button>
  );
}
