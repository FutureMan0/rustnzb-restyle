import { Injectable, signal, effect } from '@angular/core';

export type ThemeMode = 'auto' | 'light' | 'dark' | 'oled';

/** Akzentfarben im Stil Ruddarr / Apple-App-Namen (Theme.swift). */
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

const MODE_KEY = 'rustnzb.colorScheme';
const TINT_KEY = 'rustnzb.tint';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.readMode());
  readonly tint = signal<TintName>(this.readTint());

  constructor() {
    effect(() => {
      this.mode();
      this.tint();
      this.apply();
    });
  }

  setMode(m: ThemeMode): void {
    localStorage.setItem(MODE_KEY, m);
    this.mode.set(m);
  }

  setTint(t: TintName): void {
    localStorage.setItem(TINT_KEY, t);
    this.tint.set(t);
  }

  private readMode(): ThemeMode {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'light' || v === 'dark' || v === 'auto' || v === 'oled' ? v : 'dark';
  }

  private readTint(): TintName {
    const v = localStorage.getItem(TINT_KEY) as TintName | null;
    const valid: TintName[] = [
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
    return v && valid.includes(v) ? v : 'purple';
  }

  private apply(): void {
    const root = document.documentElement;
    root.setAttribute('data-color-scheme', this.mode());
    root.setAttribute('data-tint', this.tint());
  }
}
