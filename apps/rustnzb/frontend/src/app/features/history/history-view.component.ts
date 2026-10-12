import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { EMPTY, Observable, expand, map, reduce } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { HistoryEntry, LogEntry, LogsResponse, StatusResponse } from '../../core/models/queue.model';
import { ConfirmService } from '../../shared/confirm.service';
import { showHttpError } from '../../core/http/http-error';
import { formatBytes as fmtBytes, formatSpeed as fmtSpeed } from '../../core/format';

type StatusFilter = 'all' | 'completed' | 'failed';
type TimeFilter = '7d' | '30d' | 'all';

/** Aggregates the server computes over the whole time window. */
interface HistoryStats {
  completed: number;
  completed_bytes: number;
  failed: number;
  success_pct: number;
  avg_duration_secs: number | null;
  fail_reasons: { reason: string; count: number }[];
}

interface HistoryPage {
  entries: HistoryEntry[];
  /** Entries matching the filters across all pages. */
  total?: number;
  categories?: string[];
  stats?: HistoryStats;
}

const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 200;

@Component({
  selector: 'app-history-view',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule, MatMenuModule, MatButtonModule, MatIconModule],
  template: `
    <!-- Stat cards (server-computed over the whole time window) -->
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
        <input
          placeholder="Filter name…"
          aria-label="Filter by name"
          [(ngModel)]="nameFilter"
          (ngModelChange)="onNameFilterChanged()"
        />
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
          <div class="filter-menu-body" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <label for="hist-f-status">Status</label>
            <select id="hist-f-status" [(ngModel)]="filterStatus" (ngModelChange)="onFiltersChanged()">
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <label for="hist-f-cat">Category</label>
            <select id="hist-f-cat" [(ngModel)]="filterCategory" (ngModelChange)="onFiltersChanged()">
              <option value="">All</option>
              @for (cat of categoryOptions(); track cat) {
                <option [value]="cat">{{ cat }}</option>
              }
            </select>
            <label for="hist-f-time">Time</label>
            <select id="hist-f-time" [(ngModel)]="filterTime" (ngModelChange)="onFiltersChanged()">
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        </mat-menu>
        <button
          type="button"
          class="btn sm"
          (click)="exportCsv()"
          [disabled]="exporting()"
          title="Exports every entry matching the filters"
        >
          {{ exporting() ? 'Exporting…' : 'Export' }}
        </button>
        @if (total() > 0) {
          <button type="button" class="btn sm danger" (click)="clearAll()">Clear</button>
        }
      </div>
    </div>

    <p class="hist-count">{{ rangeLabel() }}</p>

    <!-- Mobile: cards -->
    <div class="list-mobile-only">
      @if (loading()) {
        <div class="inset-section__body">
          <div class="empty-state"><p>Loading…</p></div>
        </div>
      } @else if (filteredEntries().length === 0) {
        <div class="inset-section__body">
          <div class="empty-state">
            <div class="empty-state__icon" aria-hidden="true">📜</div>
            @if (narrowingFilters()) {
              <h3>No match</h3>
              <p>No entries match the current filter.</p>
            } @else if (filterTime === 'all') {
              <h3>No history</h3>
              <p>Finished jobs will show up here.</p>
            } @else {
              <h3>Nothing recent</h3>
              <p>No downloads finished in the last {{ statCards().windowLabel }}.</p>
            }
          </div>
        </div>
      } @else {
        @for (e of filteredEntries(); track e.id) {
          <div
            class="group-box hist-item"
            [class.hist-item--ok]="e.status === 'completed'"
            [class.hist-item--fail]="e.status === 'failed'"
            [class.hist-item--open]="selectedId() === e.id"
          >
            <div
              class="hist-item__head"
              role="button"
              tabindex="0"
              [attr.aria-expanded]="selectedId() === e.id"
              (click)="selectEntry(e)"
              (keydown.enter)="selectEntry(e)"
              (keydown.space)="$event.preventDefault(); selectEntry(e)"
            >
              <span class="group-box__caption">{{ e.status | uppercase }}</span>
              <div class="group-box__title" [class.dim]="e.status === 'failed'">{{ e.name }}</div>
              @if (e.error_message) {
                <div class="e-err e-err--wrap">{{ e.error_message }}</div>
              }
              @if (e.stages && e.stages.length > 0) {
                <div class="stage-chips" aria-label="Post-processing stages">
                  @for (s of e.stages; track s.name) {
                    <span class="stage-chip" [class.stage-chip--bad]="s.status === 'failed'">
                      {{ s.name }} · {{ formatStageDuration(s.duration_secs) }}
                    </span>
                  }
                </div>
              }
              <div class="completion-line">
                <span>{{ completionSummary(e) }}</span>
                @if (e.output_dir) {
                  <span class="path-label">Moved to {{ e.output_dir }}</span>
                }
              </div>
              <div class="bullet-row">
                @if (e.category) {
                  <span class="tag cat">{{ e.category }}</span>
                  <span class="sep">•</span>
                }
                <span class="tabular-nums">{{ formatBytes(e.total_bytes) }}</span>
                <span class="sep">•</span>
                <span class="tabular-nums">{{ formatSpeed(averageSpeed(e)) }}</span>
                <span class="sep">•</span>
                <span class="tabular-nums">{{ totalDurationLabel(e) }}</span>
                <span class="sep">•</span>
                <span>{{ relativeTime(e.completed_at) }}</span>
              </div>
            </div>
            @if (selectedId() === e.id) {
              <div class="hist-item__detail">
                <ng-container [ngTemplateOutlet]="detailTpl" [ngTemplateOutletContext]="{ $implicit: e }" />
              </div>
            }
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
      @if (hasPrev() || hasNext()) {
        <div class="pager pager--mobile">
          <button type="button" class="btn sm ghost" (click)="prevPage()" [disabled]="!hasPrev()">‹ Newer</button>
          <span class="hint">{{ rangeLabel() }}</span>
          <button type="button" class="btn sm ghost" (click)="nextPage()" [disabled]="!hasNext()">Older ›</button>
        </div>
      }
    </div>

    <!-- Desktop: table -->
    <div class="panel tbl-desktop-only">
      <h3>Finished jobs <span class="hint">{{ rangeLabel() }}</span></h3>
      <div class="body flush">
        <table class="data">
          <thead>
            <tr>
              <th class="name-column">Name</th>
              <th>Category</th>
              <th>Size</th>
              <th>Avg speed</th>
              <th>Duration</th>
              <th>Done</th>
              <th>Status</th>
              <th style="width:1%"></th>
            </tr>
          </thead>
          <tbody>
            @for (e of filteredEntries(); track e.id) {
              <tr
                class="history-row"
                [class.selected]="selectedId() === e.id"
                tabindex="0"
                [attr.aria-expanded]="selectedId() === e.id"
                (click)="selectEntry(e)"
                (keydown.enter)="selectEntry(e)"
                (keydown.space)="$event.preventDefault(); selectEntry(e)"
              >
                <td class="name-cell">
                  <div class="e-name" [class.dim]="e.status === 'failed'" [title]="e.name">{{ e.name }}</div>
                  <div class="e-sub">{{ completionSummary(e) }}</div>
                  @if (e.output_dir) {
                    <div class="e-path" [title]="e.output_dir">{{ e.output_dir }}</div>
                  }
                  @if (e.error_message) {
                    <div class="e-err" [title]="e.error_message">{{ e.error_message }}</div>
                  }
                </td>
                <td>
                  @if (e.category) {
                    <span class="tag cat">{{ e.category }}</span>
                  }
                </td>
                <td class="tabular-nums">{{ formatBytes(e.total_bytes) }}</td>
                <td class="tabular-nums">{{ formatSpeed(averageSpeed(e)) }}</td>
                <td class="tabular-nums">
                  <div>{{ totalDurationLabel(e) }}</div>
                  <div class="duration-breakdown">{{ durationBreakdown(e) }}</div>
                </td>
                <td>{{ relativeTime(e.completed_at) }}</td>
                <td>
                  <span class="status-pill" [class]="e.status === 'completed' ? 's-ok' : 's-fail'">{{ e.status }}</span>
                </td>
                <td class="actions-cell">
                  <div class="actions">
                    @if (e.status === 'failed') {
                      <button type="button" class="row-action warn" (click)="$event.stopPropagation(); retry(e.id)" title="Retry" aria-label="Retry">↻</button>
                    }
                    @if (e.status === 'completed' && webdavEnabled()) {
                      <button type="button" class="row-action media" (click)="$event.stopPropagation(); addToMedia(e.id)" title="Add to Media Library" aria-label="Add to Media Library">▶</button>
                    }
                    <button type="button" class="row-action" (click)="$event.stopPropagation(); openOutput(e)">open</button>
                    <button type="button" class="row-action danger" (click)="$event.stopPropagation(); remove(e.id)" title="Delete" aria-label="Delete">✕</button>
                  </div>
                </td>
              </tr>
              @if (selectedId() === e.id) {
                <tr class="detail-row">
                  <td colspan="8">
                    <div class="detail-wrap">
                      <ng-container [ngTemplateOutlet]="detailTpl" [ngTemplateOutletContext]="{ $implicit: e }" />
                    </div>
                  </td>
                </tr>
              }
            }
            @if (loading()) {
              <tr>
                <td colspan="8" class="empty-cell">Loading…</td>
              </tr>
            } @else if (filteredEntries().length === 0) {
              <tr>
                <td colspan="8" class="empty-cell">
                  @if (narrowingFilters()) {
                    No entries match the current filter.
                  } @else if (filterTime === 'all') {
                    No download history yet. Finished jobs will show up here.
                  } @else {
                    No downloads finished in the last {{ statCards().windowLabel }}.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (hasPrev() || hasNext()) {
        <div class="pager">
          <button type="button" class="btn ghost" (click)="prevPage()" [disabled]="!hasPrev()">‹ Newer</button>
          <span class="hint">{{ rangeLabel() }}</span>
          <button type="button" class="btn ghost" (click)="nextPage()" [disabled]="!hasNext()">Older ›</button>
        </div>
      }
    </div>

    <!-- Shared detail panel (mobile card + desktop row) -->
    <ng-template #detailTpl let-row>
      @if (detailLoading()) {
        <div class="detail-loading">Loading download details…</div>
      } @else {
        @let detail = selectedEntry() || row;
        <div class="detail-panel">
          <div class="detail-head">
            <div class="detail-path">{{ detail.output_dir || 'No output path recorded' }}</div>
            <button type="button" class="row-action" (click)="$event.stopPropagation(); closeDetails()" aria-label="Close details">close</button>
          </div>
          <div class="detail-metrics">
            <div><span>Downloaded</span><b>{{ formatBytes(detail.downloaded_bytes) }} / {{ formatBytes(detail.total_bytes) }}</b></div>
            <div><span>Average speed</span><b>{{ formatSpeed(averageSpeed(detail)) }}</b></div>
            <div><span>Total duration</span><b>{{ totalDurationLabel(detail) }}</b></div>
            <div><span>Download time</span><b>{{ formatOptionalDuration(downloadSecs(detail)) }}</b></div>
            <div><span>Post-processing</span><b>{{ formatOptionalDuration(postProcessingSecs(detail)) }}</b></div>
            <div><span>Articles served</span><b>{{ articleServed(detail) }}</b></div>
            <div><span>Articles missing</span><b>{{ articleMissing(detail) }}</b></div>
            <div><span>Availability</span><b>{{ availability(detail) }}</b></div>
          </div>

          @if (detail.server_stats.length > 0) {
            <h4>News server usage</h4>
            <div class="detail-table-wrap">
              <table class="detail-table">
                <thead><tr><th>Server</th><th>Hits</th><th>Served</th><th>Missing</th><th>Downloaded</th></tr></thead>
                <tbody>
                  @for (server of detail.server_stats; track server.server_id) {
                    <tr>
                      <td>{{ server.server_name || server.server_id }}</td>
                      <td class="tabular-nums">{{ server.articles_downloaded + server.articles_failed }}</td>
                      <td class="tabular-nums">{{ server.articles_downloaded }}</td>
                      <td class="tabular-nums">{{ server.articles_failed }}</td>
                      <td class="tabular-nums">{{ formatBytes(server.bytes_downloaded) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @if (detail.stages.length > 0) {
            <h4>Processing stages</h4>
            <div class="stages">
              @for (stage of detail.stages; track stage.name) {
                <div class="stage">
                  <span class="status-pill" [class]="stage.status === 'success' ? 's-ok' : stage.status === 'failed' ? 's-fail' : 's-paused'">{{ stage.status }}</span>
                  <b>{{ stage.name }}</b>
                  <span class="tabular-nums">{{ formatStageDuration(stage.duration_secs) }}</span>
                  @if (stage.message) { <span class="stage-message">{{ stage.message }}</span> }
                </div>
              }
            </div>
          }
          @if (detail.error_message) {
            <div class="detail-error">{{ detail.error_message }}</div>
          }

          <h4>Job log</h4>
          @if (jobLogs() === null) {
            <button type="button" class="btn sm" (click)="$event.stopPropagation(); loadLogs(detail.id)" [disabled]="logsLoading()">
              {{ logsLoading() ? 'Loading…' : 'Show log' }}
            </button>
          } @else if (jobLogs()!.length === 0) {
            <div class="detail-muted">No log lines were recorded for this job.</div>
          } @else {
            <div class="job-log" (click)="$event.stopPropagation()">
              @for (l of jobLogs(); track l.seq) {
                <div class="job-log__line">
                  <span class="job-log__ts tabular-nums">{{ l.timestamp | date: 'HH:mm:ss' }}</span>
                  <span class="job-log__lv" [class]="'job-log__lv lv-' + l.level.toLowerCase()">{{ l.level }}</span>
                  <span class="job-log__msg">{{ l.message }}</span>
                </div>
              }
            </div>
          }
        </div>
      }
    </ng-template>
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

    /* Desktop table */
    .name-column, .name-cell { width: 36%; }
    .name-cell { max-width: 0; }
    .e-name, .e-err, .e-path, .e-sub {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .e-name { color: var(--text); font-size: 13px; }
    .e-name.dim { color: var(--mute); }
    .e-sub,
    .e-path,
    .completion-line,
    .duration-breakdown {
      font: var(--font-footnote);
      color: var(--text-secondary);
    }
    .duration-breakdown { white-space: nowrap; }
    .path-label { word-break: break-all; }
    .e-err { color: var(--danger); font: var(--font-footnote); margin-top: 2px; opacity: 0.9; }
    .e-err--wrap { white-space: normal; overflow: visible; margin: 0 0 6px; }
    .actions-cell { white-space: nowrap; }
    .actions { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
    .row-action.media { color: var(--tint); border-color: var(--tint); }
    .history-row { cursor: pointer; }
    .history-row:focus-visible { outline: 2px solid var(--tint); outline-offset: -2px; }
    .history-row.selected td { background: var(--row-hover); border-bottom-color: transparent; }
    .detail-row > td { padding: 0 !important; background: var(--panel2); }
    .detail-row:hover td { background: var(--panel2); }
    .detail-wrap { padding: 14px 18px 18px; border-bottom: 1px solid var(--line); }
    .empty-cell {
      text-align: center;
      padding: 36px 20px !important;
      color: var(--text-secondary);
      font-size: 13px;
    }
    .pager {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      padding: 10px 14px;
      border-top: 1px solid var(--line);
    }
    .pager .hint { font: var(--font-footnote); color: var(--text-secondary); }
    .pager--mobile { justify-content: space-between; border-top: none; padding: 4px 0 12px; }

    /* Mobile cards */
    .group-box__title.dim { color: var(--mute); }
    .hist-item { position: relative; overflow: hidden; }
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
    .hist-item__head { cursor: pointer; outline: none; border-radius: 8px; }
    .hist-item__head:focus-visible { outline: 2px solid var(--tint); outline-offset: 2px; }
    .hist-item__detail {
      margin: 10px -14px 0;
      padding: 12px 14px;
      background: var(--panel2);
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .completion-line {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 6px 0 4px;
    }
    .stage-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 2px; }
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
    .hist-row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

    /* Detail panel (shared) */
    .detail-loading, .detail-muted { color: var(--text-secondary); font: var(--font-footnote); padding: 4px 0; }
    .detail-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
    }
    .detail-path { color: var(--text-secondary); font: var(--font-footnote); word-break: break-all; }
    .detail-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .detail-metrics > div {
      padding: 9px 10px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius-row);
      min-width: 0;
    }
    .detail-metrics span {
      display: block;
      font: var(--font-caption);
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .detail-metrics b { display: block; margin-top: 3px; font-size: 13px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    h4 {
      margin: 16px 0 7px;
      font: var(--font-footnote);
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .detail-table-wrap { overflow-x: auto; }
    .detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .detail-table th, .detail-table td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; }
    .detail-table th { color: var(--text-secondary); font-weight: 500; }
    .stages { display: flex; flex-direction: column; gap: 6px; }
    .stage { display: grid; grid-template-columns: 72px minmax(90px, 150px) 70px 1fr; gap: 8px; align-items: center; font-size: 12px; }
    .stage > span:not(.status-pill) { color: var(--text-secondary); }
    .stage-message { overflow-wrap: anywhere; }
    .detail-error {
      margin-top: 14px;
      padding: 9px 11px;
      color: var(--fail-text);
      background: var(--fail-bg);
      border-radius: var(--radius-row);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .job-log {
      max-height: 280px;
      overflow: auto;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius-row);
      padding: 8px 10px;
      font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .job-log__line { display: flex; gap: 8px; }
    .job-log__ts { color: var(--mute); flex-shrink: 0; }
    .job-log__lv { flex-shrink: 0; min-width: 40px; font-weight: 600; color: var(--text-secondary); }
    .job-log__lv.lv-info { color: var(--tint); }
    .job-log__lv.lv-warn { color: var(--warn); }
    .job-log__lv.lv-error { color: var(--danger); }
    .job-log__lv.lv-debug, .job-log__lv.lv-trace { color: var(--mute); }
    .job-log__msg { color: var(--text); word-break: break-word; min-width: 0; }

    @media (max-width: 1023px) {
      .detail-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stage { grid-template-columns: auto 1fr auto; }
      .stage-message { grid-column: 1 / -1; }
    }
  `],
})
export class HistoryViewComponent implements OnInit, OnDestroy {
  loading = signal(true);
  /** The current page of entries, already filtered by the server. */
  entries = signal<HistoryEntry[]>([]);
  /** Entries matching the filters across all pages. */
  total = signal(0);
  offset = signal(0);
  readonly pageSize = PAGE_SIZE;
  exporting = signal(false);
  private categories = signal<string[] | null>(null);
  private stats = signal<HistoryStats | null>(null);
  private loadSeq = 0;
  private nameDebounce: ReturnType<typeof setTimeout> | null = null;
  selectedId = signal<string | null>(null);
  selectedEntry = signal<HistoryEntry | null>(null);
  detailLoading = signal(false);
  /** Persisted per-job log of the selected entry; null = not loaded yet. */
  jobLogs = signal<LogEntry[] | null>(null);
  logsLoading = signal(false);
  webdavEnabled = signal(false);
  filterStatus: StatusFilter = 'all';
  filterCategory = '';
  filterTime: TimeFilter = '7d';
  nameFilter = '';

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: ApiService,
    private snack: MatSnackBar,
    private confirmSvc: ConfirmService,
  ) {}

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
    if (this.nameDebounce) clearTimeout(this.nameDebounce);
  }

  hasActiveFilters(): boolean {
    return (
      this.nameFilter.trim() !== '' ||
      this.filterStatus !== 'all' ||
      this.filterCategory !== '' ||
      this.filterTime !== '7d'
    );
  }

  /** Query parameters for the active filters (shared by paging and export). */
  private filterParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.filterStatus !== 'all') params['status'] = this.filterStatus;
    if (this.filterCategory) params['category'] = this.filterCategory;
    const name = this.nameFilter.trim();
    if (name) params['search'] = name;
    if (this.filterTime !== 'all') params['days'] = this.filterTime === '7d' ? '7' : '30';
    return params;
  }

  load(): void {
    const seq = ++this.loadSeq;
    const params = { offset: String(this.offset()), limit: String(PAGE_SIZE), ...this.filterParams() };
    this.api.get<HistoryPage>('/history', params).subscribe({
      next: r => {
        // A slower response for superseded filters/page must not win.
        if (seq !== this.loadSeq) return;
        const entries = r.entries || [];
        const total = r.total ?? entries.length;
        // The page we were on vanished (deletes, retention): go to the last one.
        if (entries.length === 0 && this.offset() > 0 && this.offset() >= total) {
          this.offset.set(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) * PAGE_SIZE);
          this.load();
          return;
        }
        this.entries.set(entries);
        this.total.set(total);
        this.categories.set(r.categories ?? null);
        this.stats.set(r.stats ?? null);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onFiltersChanged(): void {
    this.offset.set(0);
    this.closeDetails();
    this.load();
  }

  onNameFilterChanged(): void {
    if (this.nameDebounce) clearTimeout(this.nameDebounce);
    this.nameDebounce = setTimeout(() => this.onFiltersChanged(), 250);
  }

  hasPrev(): boolean {
    return this.offset() > 0;
  }

  hasNext(): boolean {
    return this.offset() + PAGE_SIZE < this.total();
  }

  prevPage(): void {
    if (!this.hasPrev()) return;
    this.offset.set(Math.max(0, this.offset() - PAGE_SIZE));
    this.load();
  }

  nextPage(): void {
    if (!this.hasNext()) return;
    this.offset.set(this.offset() + PAGE_SIZE);
    this.load();
  }

  rangeLabel(): string {
    const total = this.total();
    if (total === 0) return '0 of 0';
    const start = Math.min(this.offset() + 1, total);
    const end = Math.min(this.offset() + PAGE_SIZE, total);
    return `${start}–${end} of ${total}`;
  }

  /** Filters other than the time window are narrowing the list. */
  narrowingFilters(): boolean {
    return this.filterStatus !== 'all' || !!this.filterCategory || !!this.nameFilter.trim();
  }

  selectEntry(entry: HistoryEntry): void {
    if (this.selectedId() === entry.id) {
      this.closeDetails();
      return;
    }
    this.selectedId.set(entry.id);
    this.selectedEntry.set(entry);
    this.jobLogs.set(null);
    this.logsLoading.set(false);
    this.detailLoading.set(true);
    this.api.get<HistoryEntry>(`/history/${encodeURIComponent(entry.id)}`).subscribe({
      next: detail => {
        // Ignore a late response for an entry that is no longer selected.
        if (this.selectedId() !== entry.id) return;
        this.selectedEntry.set(detail);
        this.detailLoading.set(false);
      },
      error: () => {
        if (this.selectedId() === entry.id) this.detailLoading.set(false);
      },
    });
  }

  closeDetails(): void {
    this.selectedId.set(null);
    this.selectedEntry.set(null);
    this.detailLoading.set(false);
    this.jobLogs.set(null);
    this.logsLoading.set(false);
  }

  /** Fetches the persisted log lines recorded for one finished job. */
  loadLogs(id: string): void {
    if (this.logsLoading()) return;
    this.logsLoading.set(true);
    this.api.get<LogsResponse>(`/history/${encodeURIComponent(id)}/logs`).subscribe({
      next: r => {
        if (this.selectedId() !== id) return;
        this.jobLogs.set(r.entries || []);
        this.logsLoading.set(false);
      },
      error: err => {
        this.logsLoading.set(false);
        showHttpError(this.snack, err, 'Failed to load job log');
      },
    });
  }

  /** All categories in history (server-provided), not just the visible page. */
  categoryOptions = computed(
    () =>
      this.categories() ??
      Array.from(new Set(this.entries().map(e => e.category).filter(c => !!c))).sort(),
  );

  /** The current page; filtering happens server-side. */
  filteredEntries(): HistoryEntry[] {
    return this.entries();
  }

  /**
   * The 4 stat cards at the top. The server computes them over the whole
   * time window (ignoring the status/category/name filters) so the
   * success-rate card stays meaningful when the user filters to failures.
   */
  statCards = computed(() => {
    const st = this.stats();
    const failed = st?.failed ?? 0;
    const topReasons = (st?.fail_reasons ?? [])
      .slice(0, 2)
      .map(r => `${r.count} ${r.reason}`)
      .join(' · ');
    return {
      windowLabel: this.filterTime === 'all' ? 'all time' : this.filterTime === '7d' ? '7 days' : '30 days',
      completed: st?.completed ?? 0,
      completedBytes: st?.completed_bytes ?? 0,
      failed,
      failReasons: failed === 0 || !topReasons ? 'none' : topReasons,
      successPct: st?.success_pct ?? 0,
      avgDurationLabel:
        st?.avg_duration_secs != null ? this.formatShortDuration(st.avg_duration_secs) : '—',
    };
  });

  retry(id: string): void {
    this.api.post(`/history/${id}/retry`).subscribe({
      next: () => {
        this.load();
        this.snack.open('Retrying…', 'Close', { duration: 2000 });
      },
      error: (err) => showHttpError(this.snack, err, 'Failed to retry job'),
    });
  }

  addToMedia(id: string): void {
    this.api.post(`/dav/add?id=${id}`).subscribe({
      next: () => this.snack.open('Queued for Media Library', 'Close', { duration: 3000 }),
      error: (err) => showHttpError(this.snack, err, 'Failed to add to Media Library'),
    });
  }

  remove(id: string): void {
    this.api.delete(`/history/${id}`).subscribe({
      next: () => {
        if (this.selectedId() === id) this.closeDetails();
        this.load();
      },
      error: (err) => showHttpError(this.snack, err, 'Failed to delete history entry'),
    });
  }

  clearAll(): void {
    this.confirmSvc
      .confirm({
        title: 'Clear all history?',
        message: 'This permanently deletes every history entry. This cannot be undone.',
        confirmLabel: 'Clear all',
        danger: true,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.api.delete('/history').subscribe({
          next: () => {
            this.closeDetails();
            this.load();
            this.snack.open('History cleared', 'Close', { duration: 2000 });
          },
          error: (err) => showHttpError(this.snack, err, 'Failed to clear history'),
        });
      });
  }

  openOutput(e: HistoryEntry): void {
    // No server endpoint for "reveal in file manager"; surface the path.
    this.snack.open(e.output_dir || '(no output path recorded)', 'Close', { duration: 5000 });
  }

  /** Every entry matching the current filters, fetched page by page. */
  fetchAllMatching(): Observable<HistoryEntry[]> {
    const filters = this.filterParams();
    const page = (offset: number) =>
      this.api
        .get<HistoryPage>('/history', { offset: String(offset), limit: String(EXPORT_PAGE_SIZE), ...filters })
        .pipe(map(r => ({ offset, entries: r.entries || [], total: r.total ?? 0 })));
    return page(0).pipe(
      expand(p => {
        const next = p.offset + p.entries.length;
        return p.entries.length > 0 && next < p.total ? page(next) : EMPTY;
      }),
      reduce((all, p) => all.concat(p.entries), [] as HistoryEntry[]),
    );
  }

  exportCsv(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.fetchAllMatching().subscribe({
      next: entries => {
        this.exporting.set(false);
        this.downloadCsv(entries);
      },
      error: (err) => {
        this.exporting.set(false);
        showHttpError(this.snack, err, 'Failed to export history');
      },
    });
  }

  private downloadCsv(entries: HistoryEntry[]): void {
    const rows = [[
      'name', 'category', 'size_bytes', 'average_speed_bps', 'status', 'download_secs',
      'total_secs', 'output_dir', 'added_at', 'completed_at', 'error',
    ]];
    for (const e of entries) {
      const download = this.downloadSecs(e);
      const total = this.totalDurationSecs(e);
      rows.push([
        e.name, e.category || '', String(e.total_bytes), String(this.averageSpeed(e)), e.status,
        download != null ? String(Math.round(download)) : '',
        total != null ? String(Math.round(total)) : '',
        e.output_dir || '', e.added_at, e.completed_at, e.error_message || '',
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

  // ---- Timing ----

  /** Active download time from the server (excludes queue wait and pauses). */
  downloadSecs(e: HistoryEntry): number | null {
    return e.duration_secs != null && Number.isFinite(e.duration_secs) ? Math.max(0, e.duration_secs) : null;
  }

  /** Sum of the recorded post-processing stage durations, if any. */
  postProcessingSecs(e: HistoryEntry): number | null {
    const stages = (e.stages || []).filter(s => s.duration_secs != null && Number.isFinite(s.duration_secs));
    if (stages.length === 0) return null;
    return stages.reduce((n, s) => n + Math.max(0, s.duration_secs), 0);
  }

  /** Wall-clock time from adding the job until it finished. */
  totalDurationSecs(e: HistoryEntry): number | null {
    if (!e.added_at || !e.completed_at) return null;
    const ms = new Date(e.completed_at).getTime() - new Date(e.added_at).getTime();
    return ms > 0 ? ms / 1000 : null;
  }

  totalDurationLabel(e: HistoryEntry): string {
    return this.formatDuration(e.added_at, e.completed_at);
  }

  /** "Completed · download 4m 2s · Par2 12s · Unpack 30s" */
  completionSummary(e: HistoryEntry): string {
    const parts = [`download ${this.formatOptionalDuration(this.downloadSecs(e))}`];
    for (const s of e.stages || []) {
      parts.push(`${s.name} ${this.formatStageDuration(s.duration_secs)}`);
    }
    const label = e.status === 'completed' ? 'Completed' : e.status === 'failed' ? 'Failed' : e.status;
    return `${label} · ${parts.join(' · ')}`;
  }

  /** Short split shown under the total duration in the desktop table. */
  durationBreakdown(e: HistoryEntry): string {
    return [
      `download ${this.formatOptionalDuration(this.downloadSecs(e))}`,
      `post ${this.formatOptionalDuration(this.postProcessingSecs(e))}`,
    ].join(' · ');
  }

  formatOptionalDuration(secs: number | null | undefined): string {
    if (secs == null || !Number.isFinite(secs)) return '—';
    return this.formatShortDuration(Math.max(0, secs));
  }

  // ---- Formatting ----

  formatBytes(b: number): string {
    return fmtBytes(b);
  }

  averageSpeed(entry: HistoryEntry): number {
    if (entry.average_speed_bps != null) return entry.average_speed_bps;
    const seconds = (new Date(entry.completed_at).getTime() - new Date(entry.added_at).getTime()) / 1000;
    return seconds > 0 ? Math.round(entry.downloaded_bytes / seconds) : 0;
  }

  formatSpeed(bps: number): string {
    return fmtSpeed(bps);
  }

  articleServed(entry: HistoryEntry): number {
    return entry.articles_served ?? entry.server_stats.reduce((total, server) => total + server.articles_downloaded, 0);
  }

  articleMissing(entry: HistoryEntry): number {
    return entry.articles_missing ?? entry.server_stats.reduce((total, server) => total + server.articles_failed, 0);
  }

  availability(entry: HistoryEntry): string {
    const served = this.articleServed(entry);
    const total = served + this.articleMissing(entry);
    return total > 0 ? `${((served / total) * 100).toFixed(2)}%` : '—';
  }

  formatStageDuration(seconds: number | undefined): string {
    return seconds != null && Number.isFinite(seconds) ? this.formatShortDuration(seconds) : '—';
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
