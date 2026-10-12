import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeService } from './theme.service';

function create(): ThemeService {
  TestBed.resetTestingModule();
  return TestBed.inject(ThemeService);
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-color-scheme');
    document.documentElement.removeAttribute('data-tint');
  });

  it('applies the defaults and persists a selected mode and tint', () => {
    const service = create();
    expect(service.mode()).toBe('dark');
    expect(service.tint()).toBe('plex');
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-tint')).toBe('plex');

    service.setMode('oled');
    service.setTint('purple');
    expect(localStorage.getItem('rustnzb.colorScheme')).toBe('oled');
    expect(localStorage.getItem('rustnzb.tint')).toBe('purple');
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('oled');
    expect(document.documentElement.getAttribute('data-tint')).toBe('purple');
  });

  it('restores saved values and ignores unknown ones', () => {
    localStorage.setItem('rustnzb.colorScheme', 'light');
    localStorage.setItem('rustnzb.tint', 'not-a-tint');
    const service = create();
    expect(service.mode()).toBe('light');
    expect(service.tint()).toBe('plex');
  });
});
