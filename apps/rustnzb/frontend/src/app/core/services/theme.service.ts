import { Injectable, signal, effect } from '@angular/core';

export type ThemeMode = 'auto' | 'light' | 'dark' | 'oled';

/** Accent colours in the style of Ruddarr (Theme.swift). */
export type TintName =
  | 'blue'
  | 'purple'
  | 'green'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'mono'
  | 'brown'
  | 'barbie'
  | 'plex';

export const THEME_MODES: readonly ThemeMode[] = ['auto', 'light', 'dark', 'oled'];
export const TINT_NAMES: readonly TintName[] = [
  'blue',
  'purple',
  'green',
  'red',
  'orange',
  'yellow',
  'mono',
  'brown',
  'barbie',
  'plex',
];

const MODE_KEY = 'rustnzb.colorScheme';
const TINT_KEY = 'rustnzb.tint';

// Storage can be unavailable (private mode, blocked site data); the theme
// then simply falls back to its defaults for this session.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted */
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.readMode());
  readonly tint = signal<TintName>(this.readTint());

  constructor() {
    this.apply();
    effect(() => {
      this.mode();
      this.tint();
      this.apply();
    });
  }

  setMode(m: ThemeMode): void {
    if (!THEME_MODES.includes(m)) return;
    writeStored(MODE_KEY, m);
    this.mode.set(m);
    this.apply();
  }

  setTint(t: TintName): void {
    if (!TINT_NAMES.includes(t)) return;
    writeStored(TINT_KEY, t);
    this.tint.set(t);
    this.apply();
  }

  private readMode(): ThemeMode {
    const v = readStored(MODE_KEY) as ThemeMode | null;
    return v && THEME_MODES.includes(v) ? v : 'dark';
  }

  private readTint(): TintName {
    const v = readStored(TINT_KEY) as TintName | null;
    return v && TINT_NAMES.includes(v) ? v : 'plex';
  }

  private apply(): void {
    const root = document.documentElement;
    root.setAttribute('data-color-scheme', this.mode());
    root.setAttribute('data-tint', this.tint());
  }
}
