import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatBottomSheetModule, MatBottomSheetRef, MAT_BOTTOM_SHEET_DATA } from '@angular/material/bottom-sheet';
import { GroupService } from '../../core/services/group.service';
import { HeaderRow } from '../../core/models/group.model';

export interface ArticlePreviewSheetData {
  messageId: string;
  header: HeaderRow;
  onLoaded?: () => void;
}

@Component({
  selector: 'app-article-preview-sheet',
  standalone: true,
  imports: [CommonModule, MatBottomSheetModule],
  template: `
    <div class="sheet-wrap">
      <div class="sheet-handle" aria-hidden="true"></div>
      <button type="button" class="close-x" (click)="dismiss()" aria-label="Close">✕</button>

      <span class="caption-label">ARTICLE</span>
      <h2 class="title">{{ data.header.subject }}</h2>
      <div class="bullet-row sub">
        <span>{{ data.header.author || '—' }}</span>
        <span class="sep">•</span>
        <span class="tabular-nums">{{ formatBytes(data.header.bytes) }}</span>
        <span class="sep">•</span>
        <span class="dim">{{ data.header.date }}</span>
      </div>

      @if (loading()) {
        <div class="loading">Loading article…</div>
      } @else {
        <pre class="body-pre">{{ body() || '(empty)' }}</pre>
      }
    </div>
  `,
  styles: [`
    .sheet-wrap { padding: 8px 16px 20px; max-width: 720px; margin: 0 auto; }
    .sheet-handle { width: 40px; height: 4px; border-radius: 2px; background: var(--line); margin: 4px auto 12px; }
    .close-x {
      position: absolute; top: 8px; right: 12px;
      background: none; border: none; color: var(--text-secondary);
      font-size: 18px; cursor: pointer; line-height: 1;
    }
    .caption-label {
      display: block;
      font: var(--font-caption);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--tint);
      margin-bottom: 4px;
    }
    .title { font: var(--font-title3); margin: 0 32px 8px 0; word-break: break-word; }
    .bullet-row { color: var(--text-secondary); font: var(--font-subheadline); }
    .bullet-row .dim { color: var(--text-secondary); opacity: 0.9; }
    .sep { margin: 0 4px; }
    .loading { padding: 24px; text-align: center; color: var(--text-secondary); }
    .body-pre {
      margin: 12px 0 0;
      background: var(--panel2);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      font: 12px ui-monospace, Menlo, Consolas, monospace;
      max-height: min(60vh, 480px);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `],
})
export class ArticlePreviewSheetComponent {
  private readonly ref = inject(MatBottomSheetRef<ArticlePreviewSheetComponent>);
  private readonly svc = inject(GroupService);
  readonly data = inject<ArticlePreviewSheetData>(MAT_BOTTOM_SHEET_DATA);

  loading = signal(true);
  body = signal<string | null>(null);

  constructor() {
    this.svc.getArticle(this.data.messageId).subscribe({
      next: (r) => {
        this.body.set(r.body);
        this.loading.set(false);
        this.data.onLoaded?.();
      },
      error: () => {
        this.body.set('(Failed to load)');
        this.loading.set(false);
      },
    });
  }

  dismiss(): void {
    this.ref.dismiss();
  }

  formatBytes(b: number): string {
    if (b === 0) return '0 B';
    const k = 1024;
    const s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(4, Math.floor(Math.log(b) / Math.log(k)));
    return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
  }
}
