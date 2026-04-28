import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { HistoryEntry, StatusResponse } from '../../core/models/queue.model';

type StatusFilter = 'all' | 'completed' | 'failed';
type TimeFilter = '7d' | '30d' | 'all';

@Component({
  selector: 'app-history-view',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule, MatMenuModule, MatButtonModule, MatIconModule],
  template: `
    <!-- Stat cards -->
    <div class="cards4">
      <div class="card">
        <div class="label">Completed · {{ statCards().windowLabel }}</div>
        <div class="val">{{ statCards().completed }}</div>
        <div class="sub">{{ formatBytes(statCards().completedBytes) }}</div>
      </div>
      <div class="card">
        <div class="label">Failed · {{ statCards().windowLabel }}</div>
        <div class="val">{{ statCards().failed }}</div>
        <div class="sub">{{ statCards().failReasons }}</div>
      </div>
      <div class="card">
        <div class="label">Success rate</div>
        <div class="val">{{ statCards().successPct }}%</div>
        <div class="bar green"><div [style.width.%]="statCards().successPct"></div></div>
        <div class="sub">Of recent jobs</div>
      </div>
      <div class="card">
        <div class="label">Avg job duration</div>
        <div class="val">{{ statCards().avgDurationLabel }}</div>
        <div class="sub">Download + post-processing</div>
      </div>
    </div>

    <div class="hist-toolbar">
      <div class="search-bar hist-search">
        <input placeholder="Filter name…" [(ngModel)]="nameFilter" />
      </div>
      <div class="hist-actions">
        <div class="filter-btn-wrap">
          <button type="button" mat-icon-button [matMenuTriggerFor]="filterMenu" aria-label="Filters">
            <mat-icon [class.filter-on]="hasActiveFilters()">tune</mat-icon>
          </button>
          @if (hasActiveFilters()) {
            <span class="filter-badge-dot" aria-hidden="true"></span>
          }
        </div>
        <mat-menu #filterMenu="matMenu" class="hist-filter-menu">
          <div class="filter-menu-body" (click)="$event.stopPropagation()">
            <label>Status</label>
            <select [(ngModel)]="filterStatus">
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <label>Category</label>
            <select [(ngModel)]="filterCategory">
              <option value="">All</option>
              @for (cat of categoryOptions(); track cat) {
                <option [value]="cat">{{ cat }}</option>
              }
            </select>
            <label>Time</label>
            <select [(ngModel)]="filterTime">
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        </mat-menu>
        <button type="button" class="btn sm" (click)="exportCsv()">Export</button>
        @if (entries().length > 0) {
          <button type="button" class="btn sm danger" (click)="clearAll()">Clear</button>
        }
      </div>
    </div>

    <p class="hist-count">{{ filteredEntries().length }} of {{ entries().length }} shown</p>

    <div class="inset-section list-mobile-only">
      <div class="inset-section__body">
        @if (filteredEntries().length === 0) {
          <div class="empty-state">
            <div class="empty-state__icon" aria-hidden="true">📜</div>
            @if (entries().length === 0) {
              <h3>No events</h3>
              <p>Completed jobs will appear here.</p>
            } @else {
              <h3>No match</h3>
              <p>Adjust filters.</p>
            }
          </div>
        } @else {
          @for (e of filteredEntries(); track e.id) {
            <div
              class="group-box hist-item"
              [class.hist-item--ok]="e.status === 'completed'"
              [class.hist-item--fail]="e.status === 'failed'"
            >
              <span class="group-box__caption">{{ e.status | uppercase }}</span>
              <div class="group-box__title" [class.dim]="e.status === 'failed'">{{ e.name }}</div>
              @if (e.error_message) {
                <div class="e-err">{{ e.error_message }}</div>
              }
              @if (e.stages && e.stages.length > 0) {
                <div class="stage-chips" aria-label="Post-processing stages">
                  @for (s of e.stages; track s.name) {
                    <span class="stage-chip" [class.stage-chip--bad]="s.status !== 'ok'">{{ s.name }}</span>
                  }
                </div>
              }
              <div class="bullet-row">
                @if (e.category) {
                  <span class="tag cat">{{ e.category }}</span>
                  <span class="sep">•</span>
                }
                <span class="tabular-nums">{{ formatBytes(e.total_bytes) }}</span>
                <span class="sep">•</span>
                <span class="tabular-nums">{{ formatDuration(e.added_at, e.completed_at) }}</span>
                <span class="sep">•</span>
                <span>{{ relativeTime(e.completed_at) }}</span>
              </div>
              <div class="hist-row-actions">
                @if (e.status === 'failed') {
                  <button type="button" class="btn sm" (click)="retry(e.id)">Retry</button>
                }
                @if (e.status === 'completed' && webdavEnabled()) {
                  <button type="button" class="btn sm" (click)="addToMedia(e.id)">Media</button>
                }
                <button type="button" class="btn sm ghost" (click)="openOutput(e)">Path</button>
                <button type="button" class="btn sm danger" (click)="remove(e.id)">Remove</button>
              </div>
            </div>
          }
        }
      </div>
    </div>

    <div class="panel tbl-desktop-only">
      <h3>Table</h3>
      <div class="body flush">
        <table class="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Size</th>
              <th>Duration</th>
              <th>Done</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (e of filteredEntries(); track e.id) {
              <tr>
                <td>
                  <div class="e-name" [class.dim]="e.status === 'failed'">{{ e.name }}</div>
                  @if (e.error_message) {
                    <div class="e-err">{{ e.error_message }}</div>
                  }
                </td>
                <td>
                  @if (e.category) {
                    <span class="tag cat">{{ e.category }}</span>
                  }
                </td>
                <td class="tabular-nums">{{ formatBytes(e.total_bytes) }}</td>
                <td class="tabular-nums">{{ formatDuration(e.added_at, e.completed_at) }}</td>
                <td>{{ relativeTime(e.completed_at) }}</td>
                <td>
                  <span class="status-pill" [class]="e.status === 'completed' ? 's-ok' : 's-fail'">{{ e.status }}</span>
                </td>
                <td>
                  @if (e.status === 'failed') {
                    <button type="button" class="row-action warn" (click)="retry(e.id)">↻</button>
                  }
                  @if (e.status === 'completed' && webdavEnabled()) {
                    <button type="button" class="row-action" (click)="addToMedia(e.id)">▶</button>
                  }
                  <button type="button" class="row-action" (click)="openOutput(e)">open</button>
                  <button type="button" class="row-action danger" (click)="remove(e.id)">✕</button>
                </td>
              </tr>
            }
            @if (filteredEntries().length === 0) {
              <tr>
                <td colspan="7" class="empty-cell">No rows.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .hist-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .hist-search { flex: 1; min-width: 200px; margin-bottom: 0; }
    .hist-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    mat-icon.filter-on { color: var(--tint); }
    .hist-count {
      font: var(--font-footnote);
      color: var(--text-secondary);
      margin: 0 0 12px;
    }
    .filter-menu-body {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 220px;
    }
    .filter-menu-body label {
      font: var(--font-footnote);
      color: var(--text-secondary);
    }
    .filter-menu-body select {
      min-height: 40px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--panel2);
      color: var(--text);
      padding: 6px 8px;
    }
    .e-name { color: var(--text); font-size: 13px; }
    .e-name.dim { color: var(--mute); }
    .group-box__title.dim { color: var(--mute); }
    .hist-item {
      position: relative;
      overflow: hidden;
    }
    .hist-item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--tint);
      border-radius: var(--radius-card) 0 0 var(--radius-card);
    }
    .hist-item--ok::before { background: var(--accent2); }
    .hist-item--fail::before { background: var(--danger); }
    .stage-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 6px 0 2px;
    }
    .stage-chip {
      font: 10px/1.2 -apple-system, sans-serif;
      padding: 3px 7px;
      border-radius: 6px;
      background: var(--tint-soft);
      color: var(--text);
    }
    .stage-chip--bad {
      color: var(--warn);
      background: color-mix(in srgb, var(--warn) 20%, var(--card));
    }
    .e-err { color: var(--danger); font: var(--font-footnote); margin: 0 0 6px; opacity: 0.9; }
    .hist-row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .empty-cell {
      text-align: center;
      padding: 36px 20px !important;
      color: var(--text-secondary);
      font-size: 13px;
    }
  `],
})
export class HistoryViewComponent implements OnInit, OnDestroy {
  entries = signal<HistoryEntry[]>([]);
  webdavEnabled = signal(false);
  filterStatus: StatusFilter = 'all';
  filterCategory = '';
  filterTime: TimeFilter = '7d';
  nameFilter = '';

  hasActiveFilters(): boolean {
    return (
      this.nameFilter.trim() !== '' ||
      this.filterStatus !== 'all' ||
      this.filterCategory !== '' ||
      this.filterTime !== '7d'
    );
  }

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private api: ApiService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.load();
    this.api.get<StatusResponse>('/status').subscribe({
      next: s => this.webdavEnabled.set(!!s.webdav_enabled),
      error: () => {},
    });
    this.pollTimer = setInterval(() => this.load(), 5000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  load(): void {
    this.api.get<{ entries: HistoryEntry[] }>('/history').subscribe({
      next: r => this.entries.set(r.entries || []),
      error: () => {},
    });
  }

  categoryOptions = computed(() =>
    Array.from(new Set(this.entries().map(e => e.category).filter(c => !!c))).sort()
  );

  /**
   * Returns entries filtered by *all* active filters. Not memoized as a
   * signal because it depends on plain fields (ngModel) that don't trigger
   * signal recomputation — the template re-renders on change detection
   * anyway.
   */
  filteredEntries(): HistoryEntry[] {
    const cutoff = this.timeCutoffMs();
    const name = this.nameFilter.trim().toLowerCase();
    return this.entries().filter(e => {
      if (this.filterStatus !== 'all' && e.status !== this.filterStatus) return false;
      if (this.filterCategory && e.category !== this.filterCategory) return false;
      if (cutoff > 0 && new Date(e.completed_at).getTime() < cutoff) return false;
      if (name && !e.name.toLowerCase().includes(name)) return false;
      return true;
    });
  }

  private timeCutoffMs(): number {
    if (this.filterTime === 'all') return 0;
    const now = Date.now();
    const days = this.filterTime === '7d' ? 7 : 30;
    return now - days * 86400_000;
  }

  /**
   * Computed aggregate for the 4 stat cards at the top. Uses the time
   * window filter (but ignores the status filter) so the success-rate
   * card remains meaningful when the user filters to just failures.
   */
  statCards = computed(() => {
    const cutoff = this.timeCutoffMs();
    const inWindow = this.entries().filter(e =>
      cutoff === 0 || new Date(e.completed_at).getTime() >= cutoff
    );
    const completed = inWindow.filter(e => e.status === 'completed');
    const failed = inWindow.filter(e => e.status === 'failed');
    const completedBytes = completed.reduce((n, e) => n + e.total_bytes, 0);
    const total = inWindow.length;
    const successPct = total === 0 ? 0 : Math.round((completed.length / total) * 100);

    let avgDurationLabel = '—';
    if (completed.length > 0) {
      const total = completed.reduce((n, e) => {
        return n + (new Date(e.completed_at).getTime() - new Date(e.added_at).getTime());
      }, 0);
      avgDurationLabel = this.formatShortDuration(total / completed.length / 1000);
    }

    const reasonCounts = new Map<string, number>();
    for (const f of failed) {
      const reason = (f.error_message || 'unknown').split(/[.:]/)[0].slice(0, 32);
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
    const topReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([r, n]) => `${n} ${r}`)
      .join(' · ') || 'none';

    return {
      windowLabel: this.filterTime === 'all' ? 'all time' : this.filterTime === '7d' ? '7 days' : '30 days',
      completed: completed.length,
      completedBytes,
      failed: failed.length,
      failReasons: failed.length === 0 ? 'none' : topReasons,
      successPct,
      avgDurationLabel,
    };
  });

  retry(id: string): void {
    this.api.post(`/history/${id}/retry`).subscribe(() => {
      this.load();
      this.snack.open('Retrying…', 'Close', { duration: 2000 });
    });
  }

  addToMedia(id: string): void {
    this.api.post(`/dav/add?id=${id}`).subscribe({
      next: () => this.snack.open('Queued for Media Library', 'Close', { duration: 3000 }),
      error: () => this.snack.open('Failed to add to Media Library', 'Close', { duration: 3000 }),
    });
  }

  remove(id: string): void {
    this.api.delete(`/history/${id}`).subscribe(() => this.load());
  }

  clearAll(): void {
    if (!confirm('Clear all history?')) return;
    this.api.delete('/history').subscribe(() => {
      this.load();
      this.snack.open('History cleared', 'Close', { duration: 2000 });
    });
  }

  openOutput(e: HistoryEntry): void {
    // No server endpoint for "reveal in file manager"; surface the path.
    this.snack.open(e.output_dir || '(no output path recorded)', 'Close', { duration: 5000 });
  }

  exportCsv(): void {
    const rows = [['name', 'category', 'size_bytes', 'status', 'added_at', 'completed_at', 'error']];
    for (const e of this.filteredEntries()) {
      rows.push([
        e.name, e.category || '', String(e.total_bytes), e.status,
        e.added_at, e.completed_at, e.error_message || '',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rustnzb-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Formatting ----

  formatBytes(b: number): string {
    if (b === 0) return '0 B';
    const k = 1024;
    const s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(4, Math.floor(Math.log(b) / Math.log(k)));
    return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
  }

  formatDuration(start: string, end: string): string {
    if (!start || !end) return '—';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms <= 0) return '—';
    return this.formatShortDuration(ms / 1000);
  }

  formatShortDuration(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  relativeTime(d: string): string {
    if (!d) return '—';
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    if (diff < 86400 * 2) return 'yesterday';
    return `${Math.floor(diff / 86400)} d ago`;
  }
}
