import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatBottomSheetRef, MAT_BOTTOM_SHEET_DATA, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { timer, switchMap } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NzbJob, QueueResponse } from '../../core/models/queue.model';

export interface QueueJobSheetData {
  job: NzbJob;
  index: number;
  total: number;
}

@Component({
  selector: 'app-queue-job-sheet',
  standalone: true,
  imports: [CommonModule, MatBottomSheetModule],
  template: `
    <div class="sheet-wrap">
      <div class="sheet-handle" aria-hidden="true"></div>
      <button type="button" class="close-x" (click)="dismiss()" aria-label="Close">✕</button>

      <div class="header-row">
        <div
          class="ring"
          [ngStyle]="{ '--p': percent(job()) }"
          [attr.aria-label]="'Progress ' + percent(job()) + ' percent'"
          role="img"
        >
          <span class="ring-pct tabular-nums">{{ percent(job()) }}%</span>
        </div>
        <div class="header-text">
          <span class="caption-label">{{ displayStatus(job().status) }}</span>
          <h2 class="title">{{ job().name }}</h2>
          <div class="bullet-row">
            <span class="tabular-nums">{{ formatBytes(job().total_bytes) }}</span>
            <span class="sep">•</span>
            <span>{{ job().category || '—' }}</span>
          </div>
        </div>
      </div>

      <div class="actions">
        @if (job().status === 'paused') {
          <button type="button" class="btn primary" (click)="resume()">Resume</button>
        } @else if (job().status === 'downloading' || isPostProc(job().status) || job().status === 'queued') {
          <button type="button" class="btn" (click)="pause()">Pause</button>
        }
        <button type="button" class="btn danger" (click)="remove()">Remove</button>
      </div>

      <h3 class="section-h">Priority</h3>
      <div class="seg" role="group" aria-label="Change priority">
        @for (p of priorityLevels; track p.v) {
          <button
            type="button"
            class="seg__btn"
            [class.seg__btn--on]="job().priority === p.v"
            (click)="setPriority(p.v)"
          >
            {{ p.label }}
          </button>
        }
      </div>

      <h3 class="section-h">Order</h3>
      <div class="move-row">
        <button type="button" class="btn" [disabled]="queueIndex() <= 0" (click)="moveTo('top')">Top</button>
        <button type="button" class="btn" [disabled]="queueIndex() <= 0" (click)="moveTo('up')">Up</button>
        <button type="button" class="btn" [disabled]="queueIndex() >= total() - 1" (click)="moveTo('down')">Down</button>
        <button
          type="button"
          class="btn"
          [disabled]="queueIndex() >= total() - 1"
          (click)="moveTo('bottom')"
        >
          Bottom
        </button>
      </div>

      <h3 class="section-h">Pipeline</h3>
      <div class="pipe-row">
        @for (step of jobPipeline(); track step.key) {
          <div
            class="pipe-step"
            [class.done]="step.state === 'done'"
            [class.active]="step.state === 'active'"
            [class.pending]="step.state === 'pending'"
          >
            <div class="pipe-dot"><span class="dot-inner">{{ stepIcon(step) }}</span></div>
            <div class="pipe-lbl">{{ step.label }}</div>
          </div>
        }
      </div>

      @if (job().server_stats && job().server_stats.length > 0) {
        <h3 class="section-h">Per-server</h3>
        <div class="server-table-wrap">
          <table class="data mini">
            <thead>
              <tr>
                <th>Server</th>
                <th>OK / fail</th>
                <th>Bytes</th>
              </tr>
            </thead>
            <tbody>
              @for (s of job().server_stats; track s.server_id) {
                <tr>
                  <td>{{ s.server_name || s.server_id }}</td>
                  <td class="tabular-nums">{{ s.articles_downloaded }} / {{ s.articles_failed }}</td>
                  <td class="tabular-nums">{{ formatBytes(s.bytes_downloaded) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <h3 class="section-h">Information</h3>
      <div class="info-rows">
        <div class="info-row">
          <span>Priority</span>
          <span>{{ priorityLabel(job().priority) }}</span>
        </div>
        <div class="info-row">
          <span>Downloaded</span>
          <span class="tabular-nums">{{ formatBytes(job().downloaded_bytes) }}</span>
        </div>
        <div class="info-row">
          <span>ETA</span>
          <span class="tabular-nums">{{ job().speed_bps > 0 ? eta(job()) : '—' }}</span>
        </div>
        <div class="info-row">
          <span>Added</span>
          <span class="dt">{{ job().added_at || '—' }}</span>
        </div>
        <div class="info-row">
          <span>Category</span>
          <span>{{ job().category || '—' }}</span>
        </div>
        <div class="info-row id-row">
          <span>Job ID</span>
          <code class="id-code">{{ job().id }}</code>
        </div>
        @if (job().error_message) {
          <div class="info-row err">
            <span>Error</span>
            <span class="err-msg">{{ job().error_message }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 540px;
        margin: 0 auto;
        padding: 0 0 24px;
        background: var(--sheet-bg);
        min-height: 40vh;
        max-height: 88vh;
        overflow-y: auto;
        border-radius: 20px 20px 0 0;
      }
      .sheet-handle {
        width: 36px;
        height: 4px;
        border-radius: 2px;
        background: var(--line);
        margin: 0 auto 10px;
      }
      .sheet-wrap {
        padding: 0 20px 8px;
        position: relative;
      }
      .close-x {
        position: absolute;
        top: 4px;
        right: 8px;
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 8px;
        min-width: 44px;
        min-height: 44px;
        z-index: 2;
      }
      .header-row {
        display: flex;
        gap: 16px;
        align-items: flex-start;
        margin-bottom: 12px;
      }
      .ring {
        --p: 0;
        flex-shrink: 0;
        width: 72px;
        height: 72px;
        border-radius: 50%;
        background: conic-gradient(var(--tint) calc(var(--p) * 1%), var(--line) 0);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .ring::after {
        content: '';
        position: absolute;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: var(--card);
        box-shadow: var(--card-elev);
      }
      .ring-pct {
        position: relative;
        z-index: 1;
        font: var(--font-title3);
        color: var(--text);
        font-size: 15px;
      }
      .header-text {
        min-width: 0;
        flex: 1;
      }
      .title {
        font: var(--font-title3);
        margin: 4px 40px 8px 0;
        word-break: break-word;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 8px 0 16px;
      }
      .section-h {
        font: var(--font-subheadline);
        font-weight: 600;
        margin: 16px 0 10px;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 11px;
      }
      .seg {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        background: var(--card);
        border: none;
        border-radius: var(--radius-pill);
        box-shadow: var(--card-elev);
        padding: 4px;
      }
      .seg__btn {
        flex: 1;
        min-width: 0;
        min-height: 40px;
        border: none;
        border-radius: var(--radius-pill);
        background: transparent;
        color: var(--text-secondary);
        font: var(--font-footnote);
        font-weight: 500;
        cursor: pointer;
        padding: 0 8px;
        transition: background var(--dur-fast) var(--ease-out-soft), color var(--dur-fast) var(--ease-out-soft);
      }
      .seg__btn--on,
      .seg__btn:hover:not(:disabled) {
        background: color-mix(in srgb, var(--tint) 20%, var(--card));
        color: var(--tint);
      }
      .move-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .move-row .btn {
        flex: 1;
        min-width: 72px;
        border-radius: var(--radius-pill);
        min-height: 44px;
      }
      .pipe-row {
        display: flex;
        flex-wrap: nowrap;
        gap: 0;
        overflow-x: auto;
        padding: 4px 0 8px;
        -webkit-overflow-scrolling: touch;
      }
      .pipe-step {
        flex: 0 0 auto;
        width: 68px;
        text-align: center;
        position: relative;
        padding: 0 2px;
      }
      .pipe-step:not(:last-child)::after {
        content: '';
        position: absolute;
        top: 16px;
        right: -50%;
        width: 100%;
        height: 2px;
        background: var(--line);
        z-index: 0;
        pointer-events: none;
      }
      .pipe-step.done:not(:last-child)::after {
        background: var(--accent2);
      }
      .pipe-dot {
        position: relative;
        z-index: 1;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--panel);
        border: 2px solid var(--line);
        margin: 0 auto 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
        color: var(--mute);
      }
      .pipe-step.done .pipe-dot {
        background: var(--accent2);
        border-color: var(--accent2);
        color: #fff;
      }
      .pipe-step.active .pipe-dot {
        background: var(--tint);
        border-color: var(--tint);
        color: #fff;
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--tint) 30%, transparent);
      }
      .dot-inner {
        line-height: 1;
      }
      .pipe-lbl {
        font: 9px/1.2 -apple-system, sans-serif;
        color: var(--mute);
        text-transform: uppercase;
        letter-spacing: 0.02em;
      }
      .pipe-step.done .pipe-lbl,
      .pipe-step.active .pipe-lbl {
        color: var(--text);
      }
      .server-table-wrap {
        overflow: auto;
        border-radius: 12px;
        border: none;
        box-shadow: var(--card-elev);
        background: var(--card);
      }
      .data.mini th,
      .data.mini td {
        padding: 8px 10px;
        font-size: 12px;
      }
      .info-rows {
        background: var(--card);
        border: none;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: var(--card-elev);
      }
      .info-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        font: var(--font-callout);
        border-bottom: 1px solid var(--line);
        align-items: flex-start;
      }
      .info-row:last-child {
        border-bottom: none;
      }
      .info-row span:first-child {
        color: var(--text-secondary);
        flex-shrink: 0;
      }
      .info-row.err {
        flex-direction: column;
      }
      .err-msg {
        color: var(--danger);
        font: var(--font-footnote);
        word-break: break-word;
      }
      .id-row {
        flex-wrap: wrap;
      }
      .id-code {
        font: 11px ui-monospace, Menlo, monospace;
        word-break: break-all;
        text-align: right;
        max-width: 100%;
      }
      .dt {
        font: var(--font-footnote);
        text-align: right;
      }
    `,
  ],
})
export class QueueJobSheetComponent {
  private ref = inject(MatBottomSheetRef<QueueJobSheetComponent, string | void>);
  private api = inject(ApiService);
  private data = inject<QueueJobSheetData>(MAT_BOTTOM_SHEET_DATA);
  private destroyRef = inject(DestroyRef);

  readonly job = signal<NzbJob>(this.data.job);
  readonly queueIndex = signal(this.data.index);
  readonly total = signal(this.data.total);

  readonly priorityLevels = [
    { v: 0, label: 'Low' },
    { v: 1, label: 'Normal' },
    { v: 2, label: 'High' },
    { v: 3, label: 'Force' },
  ] as const;

  constructor() {
    timer(0, 2000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => this.api.get<QueueResponse>('/queue')),
      )
      .subscribe({
        next: (r) => {
          const j = r.jobs.find((x) => x.id === this.data.job.id);
          if (j) {
            this.job.set(j);
            this.total.set(r.jobs.length);
            this.queueIndex.set(r.jobs.findIndex((x) => x.id === j.id));
          } else {
            this.ref.dismiss();
          }
        },
        error: () => {},
      });
  }

  dismiss(): void {
    this.ref.dismiss();
  }

  jobPipeline() {
    return this.buildPipeline(this.job());
  }

  private buildPipeline(job: NzbJob): { key: string; label: string; idx: number; state: 'done' | 'active' | 'pending' }[] {
    const order: { key: string; label: string }[] = [
      { key: 'download', label: 'Download' },
      { key: 'decode', label: 'Decode' },
      { key: 'assemble', label: 'Assemble' },
      { key: 'verify', label: 'Par2' },
      { key: 'repair', label: 'Repair' },
      { key: 'extract', label: 'Unrar' },
      { key: 'cleanup', label: 'Done' },
    ];
    const activeMap: Record<string, number> = {
      queued: 0,
      paused: 0,
      downloading: 0,
      verifying: 3,
      repairing: 4,
      extracting: 5,
      completed: 7,
      failed: 0,
    };
    const activeIdx = job.status in activeMap ? activeMap[job.status] : 0;
    if (job.status === 'failed') {
      return order.map((o, i) => ({
        ...o,
        idx: i,
        state: i === 0 ? 'active' : 'pending',
      }));
    }
    if (activeIdx >= 7) {
      return order.map((o, i) => ({
        ...o,
        idx: i,
        state: 'done' as const,
      }));
    }
    return order.map((o, i) => ({
      ...o,
      idx: i,
      state: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
    }));
  }

  stepIcon(step: { state: string; idx: number }): string {
    if (step.state === 'done') return '✓';
    return String(step.idx + 1);
  }

  isPostProc(status: string): boolean {
    return ['verifying', 'repairing', 'extracting'].includes(status);
  }

  percent(job: { total_bytes: number; downloaded_bytes: number }): number {
    if (job.total_bytes === 0) return 0;
    return Math.round((job.downloaded_bytes / job.total_bytes) * 100);
  }

  displayStatus(status: string): string {
    if (status === 'verifying') return 'PAR2 VERIFY';
    if (status === 'repairing') return 'PAR2 REPAIR';
    if (status === 'extracting') return 'EXTRACT';
    return String(status).toUpperCase();
  }

  priorityLabel(p: number): string {
    return this.priorityLevels.find((x) => x.v === p)?.label ?? 'Normal';
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(4, Math.floor(Math.log(bytes) / Math.log(k)));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + units[i];
  }

  eta(job: NzbJob): string {
    if (job.speed_bps === 0) return '—';
    const rem = job.total_bytes - job.downloaded_bytes;
    const secs = rem / job.speed_bps;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  setPriority(priority: number): void {
    const id = this.job().id;
    this.api.put(`/queue/${id}/priority`, { priority }).subscribe({
      next: () => {
        this.ref.dismiss('refresh');
      },
      error: () => {},
    });
  }

  moveTo(kind: 'top' | 'up' | 'down' | 'bottom'): void {
    const id = this.job().id;
    const n = this.total();
    const cur = this.queueIndex();
    if (n <= 0) return;
    let position = 0;
    if (kind === 'top') position = 0;
    else if (kind === 'bottom') position = n - 1;
    else if (kind === 'up') position = Math.max(0, cur - 1);
    else if (kind === 'down') position = Math.min(n - 1, cur + 1);
    this.api.post(`/queue/${id}/move`, { position }).subscribe({
      next: () => {
        this.ref.dismiss('refresh');
      },
      error: () => {},
    });
  }

  pause(): void {
    this.api.post(`/queue/${this.job().id}/pause`).subscribe(() => this.ref.dismiss('refresh'));
  }
  resume(): void {
    this.api.post(`/queue/${this.job().id}/resume`).subscribe(() => this.ref.dismiss('refresh'));
  }
  remove(): void {
    this.api.delete(`/queue/${this.job().id}`).subscribe(() => this.ref.dismiss('refresh'));
  }
}
