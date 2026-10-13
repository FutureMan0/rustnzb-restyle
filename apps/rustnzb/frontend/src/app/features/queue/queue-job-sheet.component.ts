import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatBottomSheetRef, MAT_BOTTOM_SHEET_DATA, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { EMPTY, Observable, catchError, finalize, switchMap, timer } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { PauseStateService } from '../../core/services/pause-state.service';
import { NzbJob } from '../../core/models/queue.model';
import { formatBytes } from '../../core/format';
import { showHttpError } from '../../core/http/http-error';
import { ConfirmService } from '../../shared/confirm.service';

export interface QueueJobSheetData {
  job: NzbJob;
  index: number;
  total: number;
}

/** The native API masks a job's archive password (`********`, or `""` when none). */
type MaskedJob = NzbJob & { password?: string | null };

@Component({
  selector: 'app-queue-job-sheet',
  standalone: true,
  imports: [CommonModule, MatBottomSheetModule, MatSnackBarModule],
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
          <span class="caption-label" [class.hold]="isDiskSpaceHold(job())">{{
            statusLabel(job()).toUpperCase()
          }}</span>
          <h2 class="title">{{ job().name }}</h2>
          <div class="bullet-row">
            <span class="tabular-nums">{{ formatBytes(job().total_bytes) }}</span>
            <span class="sep">•</span>
            <span>{{ job().category || '—' }}</span>
          </div>
          @if (job().articles_failed > 0) {
            <div
              class="sheet-failures"
              role="status"
              title="Articles missing or otherwise failed after all download attempts"
            >
              {{ failedArticlesLabel(job().articles_failed) }}
            </div>
          }
        </div>
      </div>

      @if (isDiskSpaceHold(job())) {
        <div class="hold-note" role="status">
          Waiting for free disk space; resumes automatically.
        </div>
      }

      <div class="actions">
        @if (effectiveStatus(job()) === 'paused') {
          <button
            type="button"
            class="btn primary"
            [disabled]="actionPending() || globalPaused()"
            [attr.title]="globalPaused() ? 'Global pause is active' : null"
            (click)="resume()"
          >
            Resume
          </button>
        } @else if (
          effectiveStatus(job()) === 'downloading' ||
          isPostProc(effectiveStatus(job())) ||
          effectiveStatus(job()) === 'queued'
        ) {
          <button
            type="button"
            class="btn"
            [disabled]="actionPending() || globalPaused()"
            [attr.title]="globalPaused() ? 'Global pause is active' : null"
            (click)="pause()"
          >
            Pause
          </button>
        }
        <button type="button" class="btn danger" [disabled]="actionPending()" (click)="remove()">
          Remove
        </button>
      </div>

      <h3 class="section-h">Priority</h3>
      <div class="seg" role="group" aria-label="Change priority">
        @for (p of priorityLevels; track p.v) {
          <button
            type="button"
            class="seg__btn"
            [class.seg__btn--on]="job().priority === p.v"
            [attr.aria-pressed]="job().priority === p.v"
            [disabled]="actionPending()"
            (click)="setPriority(p.v)"
          >
            {{ p.label }}
          </button>
        }
      </div>

      @if (categories().length > 0) {
        <h3 class="section-h">Category</h3>
        <div class="seg seg--wrap" role="group" aria-label="Change category">
          @for (c of categories(); track c) {
            <button
              type="button"
              class="seg__btn"
              [class.seg__btn--on]="job().category === c"
              [attr.aria-pressed]="job().category === c"
              [disabled]="actionPending()"
              (click)="setCategory(c)"
            >
              {{ c }}
            </button>
          }
        </div>
      }

      <h3 class="section-h">Order</h3>
      <div class="move-row">
        <button type="button" class="btn" [disabled]="actionPending() || queueIndex() <= 0" (click)="moveTo('top')">Top</button>
        <button type="button" class="btn" [disabled]="actionPending() || queueIndex() <= 0" (click)="moveTo('up')">Up</button>
        <button
          type="button"
          class="btn"
          [disabled]="actionPending() || queueIndex() >= total() - 1"
          (click)="moveTo('down')"
        >
          Down
        </button>
        <button
          type="button"
          class="btn"
          [disabled]="actionPending() || queueIndex() >= total() - 1"
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
          <span>Articles</span>
          <span class="tabular-nums">
            {{ job().articles_downloaded }} / {{ job().article_count }}
            @if (job().articles_failed > 0) {
              <span class="fail-count">· {{ job().articles_failed }} failed</span>
            }
          </span>
        </div>
        <div class="info-row">
          <span>ETA</span>
          <span class="tabular-nums">{{ shouldShowLiveMetrics(job()) ? eta(job()) : '—' }}</span>
        </div>
        <div class="info-row">
          <span>Added</span>
          <span class="dt">{{ job().added_at ? (job().added_at | date: 'medium') : '—' }}</span>
        </div>
        <div class="info-row">
          <span>Category</span>
          <span>{{ job().category || '—' }}</span>
        </div>
        <div class="info-row">
          <span>Archive password</span>
          @if (hasPassword(job())) {
            <span class="pw-mask" title="Set; the API never returns the real value">••••••••</span>
          } @else {
            <span class="dim">None</span>
          }
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
      .caption-label.hold {
        color: var(--warn);
      }
      .sheet-failures {
        color: var(--danger);
        font: var(--font-footnote);
        font-weight: 600;
        margin-top: 6px;
      }
      .hold-note {
        margin: 0 0 8px;
        padding: 10px 12px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--warn) 14%, var(--card));
        color: var(--text);
        font: var(--font-footnote);
      }
      .fail-count {
        color: var(--danger);
        margin-left: 4px;
      }
      .pw-mask {
        letter-spacing: 0.1em;
      }
      .dim {
        color: var(--mute);
      }
      .seg--wrap {
        flex-wrap: wrap;
        border-radius: var(--radius-card);
      }
      .seg--wrap .seg__btn {
        flex: 1 0 auto;
      }
      .seg__btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class QueueJobSheetComponent {
  private ref = inject(MatBottomSheetRef<QueueJobSheetComponent, string | void>);
  private api = inject(ApiService);
  private snackBar = inject(MatSnackBar);
  private confirmSvc = inject(ConfirmService);
  private data = inject<QueueJobSheetData>(MAT_BOTTOM_SHEET_DATA);
  private destroyRef = inject(DestroyRef);

  /** Shared view of the backend's global pause (kept fresh by the queue page). */
  readonly globalPaused = inject(PauseStateService).paused;
  readonly job = signal<MaskedJob>(this.data.job);
  readonly queueIndex = signal(this.data.index);
  readonly total = signal(this.data.total);
  readonly actionPending = signal(false);
  readonly categories = signal<string[]>([]);

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
        switchMap(() =>
          this.api.get<MaskedJob>(`/queue/${this.data.job.id}`).pipe(
            catchError((err: { status?: number }) => {
              // The job left the queue (finished or removed elsewhere): close and
              // let the list refresh. Transient errors keep the last snapshot.
              if (err?.status === 404) this.ref.dismiss('refresh');
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe((j) => this.job.set(j));

    this.api
      .get<{ name: string }[]>('/config/categories')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cats) => this.categories.set((cats ?? []).map((c) => c.name)),
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

  /** Row status as shown: the global pause stops downloading/queued jobs. */
  effectiveStatus(job: NzbJob): string {
    const remaining = this.remainingForJob(job);
    if (remaining === 0 && (job.status === 'downloading' || job.status === 'queued')) {
      return 'completed';
    }
    if (this.globalPaused() && (job.status === 'downloading' || job.status === 'queued')) {
      return 'paused';
    }
    return job.status;
  }

  /** Whether the disk-space guard holds this job (lifts automatically). */
  isDiskSpaceHold(job: NzbJob): boolean {
    return this.effectiveStatus(job) === 'paused' && job.pause_reason === 'disk_space';
  }

  statusLabel(job: NzbJob): string {
    if (this.isDiskSpaceHold(job)) return 'paused · low disk';
    return this.displayStatus(this.effectiveStatus(job));
  }

  hasPassword(job: MaskedJob): boolean {
    return typeof job.password === 'string' && job.password.length > 0;
  }

  failedArticlesLabel(count: number): string {
    const failed = Math.max(0, Math.floor(this.normalizeNonNegative(count)));
    return `${failed} failed article${failed === 1 ? '' : 's'}`;
  }

  shouldShowLiveMetrics(job: NzbJob): boolean {
    const status = this.effectiveStatus(job);
    return status === 'downloading' || this.isPostProc(status);
  }

  percent(job: { total_bytes: number; downloaded_bytes: number }): number {
    const total = this.normalizeNonNegative(job.total_bytes);
    if (total <= 0) return 0;
    const downloaded = this.normalizeNonNegative(job.downloaded_bytes);
    return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  }

  displayStatus(status: string): string {
    if (status === 'verifying') return 'par2 verify';
    if (status === 'repairing') return 'par2 repair';
    if (status === 'extracting') return 'extract';
    return String(status);
  }

  priorityLabel(p: number): string {
    return this.priorityLevels.find((x) => x.v === p)?.label ?? 'Normal';
  }

  formatBytes(bytes: number): string {
    return formatBytes(bytes);
  }

  eta(job: NzbJob): string {
    const speed = this.normalizeNonNegative(job.speed_bps);
    if (speed <= 0) return '—';
    const secs = this.remainingForJob(job) / speed;
    if (!Number.isFinite(secs) || secs <= 0) return '—';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  setPriority(priority: number): void {
    if (priority === this.job().priority) return;
    const id = this.job().id;
    this.withPendingAction(
      this.api.put(`/queue/${id}/priority`, { priority }),
      'Priority updated',
      'Failed to change priority',
      () => this.job.update((j) => ({ ...j, priority })),
    );
  }

  setCategory(category: string): void {
    if (category === this.job().category) return;
    const id = this.job().id;
    this.withPendingAction(
      this.api.put(`/queue/${id}/category`, { category }),
      'Category updated',
      'Failed to change category',
      () => this.job.update((j) => ({ ...j, category })),
    );
  }

  /**
   * Plain position move. Moving a job to the top lets the backend preempt the
   * running download; priorities are never derived from positions here.
   */
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
    if (position === cur) return;
    this.withPendingAction(
      this.api.post(`/queue/${id}/move`, { position }),
      'Queue position updated',
      'Unable to reorder queue',
      () => this.queueIndex.set(position),
    );
  }

  pause(): void {
    this.withPendingAction(
      this.api.post(`/queue/${this.job().id}/pause`),
      'Job paused',
      'Failed to pause job',
    );
  }

  resume(): void {
    // The backend refuses an individual resume under the global pause.
    if (this.globalPaused()) return;
    this.withPendingAction(
      this.api.post(`/queue/${this.job().id}/resume`),
      'Job resumed',
      'Failed to resume job',
    );
  }

  remove(): void {
    const job = this.job();
    this.confirmSvc
      .confirm({
        title: `Remove "${job.name}"?`,
        message:
          job.status === 'completed' || job.status === 'failed'
            ? 'This removes it from the queue view.'
            : 'This stops the download and removes it from the queue. Progress is lost.',
        confirmLabel: 'Remove',
        danger: true,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.withPendingAction(
          this.api.delete(`/queue/${job.id}`),
          'Job removed',
          'Failed to remove job',
        );
      });
  }

  private normalizeNonNegative(value: unknown): number {
    const num = typeof value === 'number' ? value : Number(value ?? 0);
    if (!Number.isFinite(num) || num < 0) return 0;
    return num;
  }

  private remainingForJob(job: Pick<NzbJob, 'total_bytes' | 'downloaded_bytes'>): number {
    const total = this.normalizeNonNegative(job.total_bytes);
    const downloaded = this.normalizeNonNegative(job.downloaded_bytes);
    return Math.max(0, total - downloaded);
  }

  /**
   * Run one job action. Without `applyLocally` the sheet closes and asks the
   * list to refresh; with it the sheet stays open and shows the change, and
   * the queue page picks it up on its next poll.
   */
  private withPendingAction(
    action: Observable<unknown>,
    successMessage: string,
    failureMessage: string,
    applyLocally?: () => void,
  ): void {
    if (this.actionPending()) return;
    this.actionPending.set(true);
    action.pipe(finalize(() => this.actionPending.set(false))).subscribe({
      next: () => {
        this.snackBar.open(successMessage, 'Close', { duration: 2500 });
        if (applyLocally) applyLocally();
        else this.ref.dismiss('refresh');
      },
      error: (err) => showHttpError(this.snackBar, err, failureMessage),
    });
  }
}
