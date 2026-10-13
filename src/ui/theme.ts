import { effect, signal } from '@preact/signals';

const KEY = 'osc-theme';
const stored = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

let manual = stored !== null;
export const isDark = signal(stored ? stored === 'dark' : !!media?.matches);
media?.addEventListener('change', (e) => {
  if (!manual) isDark.value = e.matches;
});

effect(() => {
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light';
});

export function toggleTheme(): void {
  manual = true;
  isDark.value = !isDark.value;
  try {
    localStorage.setItem(KEY, isDark.value ? 'dark' : 'light');
  } catch {
    /* storage unavailable */
  }
}
