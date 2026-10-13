import { Component, OnInit, OnDestroy, signal, computed, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Observable, finalize } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { PauseStateService } from '../../core/services/pause-state.service';
import { NzbJob, PauseReason, QueueResponse, StatusResponse } from '../../core/models/queue.model';
import { formatBytes, formatBytesParts, formatSpeed } from '../../core/format';
import { ConfirmService } from '../../shared/confirm.service';
import { isAuthHandledError, showHttpError } from '../../core/http/http-error';
import { QueueJobSheetComponent, QueueJobSheetData } from './queue-job-sheet.component';

interface ServerConfigLite {
  id: string;
  name: string;
  host: string;
  port: number;
  connections: number;
  priority: number;
  enabled: boolean;
  ssl: boolean;
}

interface DisplayConnectionCount {
  count: number;
  recent: boolean;
}

const CONNECTION_HOLD_MS = 5_000;

// One post-processing step in the inline pipeline strip. `state` drives styling.
interface PipelineStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

const DEMO_JOB_PREFIX = '__demo_q_';

const DEMO_SRV: ServerConfigLite = {
  id: '__demo_server',
  name: 'Preview (demo only)',
  host: 'news.example.com',
  port: 563,
  connections: 8,
  priority: 0,
  enabled: true,
  ssl: true,
};

const DEMO_QUEUE_JOBS: NzbJob[] = [
    {
      id: `${DEMO_JOB_PREFIX}1`,
      name: 'A.Movie.2024.1080p.BluRay.DTS.x264-GROUP',
      category: 'movies',
      status: 'downloading',
      priority: 2,
      total_bytes: 4_800_000_000,
      downloaded_bytes: 3_020_000_000,
      file_count: 42,
      files_completed: 18,
      article_count: 12_000,
      articles_downloaded: 5_200,
      articles_failed: 0,
      added_at: '2026-01-20T10:00:00Z',
      completed_at: null,
      speed_bps: 12_200_000,
      error_message: null,
      server_stats: [
        { server_id: '1', server_name: 'Primary', articles_downloaded: 5_200, articles_failed: 0, bytes_downloaded: 1.1e9 },
      ],
    },
    {
      id: `${DEMO_JOB_PREFIX}2`,
      name: 'SeriesName.S01E04.1080p.WEB.h264-GRP',
      category: 'tv',
      status: 'queued',
      priority: 1,
      total_bytes: 2_200_000_000,
      downloaded_bytes: 0,
      file_count: 8,
      files_completed: 0,
      article_count: 3_200,
      articles_downloaded: 0,
      articles_failed: 0,
      added_at: '2026-01-20T10:12:00Z',
      completed_at: null,
      speed_bps: 0,
      error_message: null,
      server_stats: [],
    },
    {
      id: `${DEMO_JOB_PREFIX}3`,
      name: 'Concert.2023.FLAC.24bit-CODEC',
      category: 'audio',
      status: 'paused',
      priority: 0,
      total_bytes: 1_200_000_000,
      downloaded_bytes: 400_000_000,
      file_count: 22,
      files_completed: 5,
      article_count: 1_000,
      articles_downloaded: 200,
      articles_failed: 0,
      added_at: '2026-01-20T09:50:00Z',
      completed_at: null,
      speed_bps: 0,
      error_message: null,
      server_stats: [],
    },
    {
      id: `${DEMO_JOB_PREFIX}4`,
      name: 'Big.Release.4K.HEVC-ENC',
      category: 'movies',
      status: 'verifying',
      priority: 1,
      total_bytes: 8_200_000_000,
      downloaded_bytes: 8_200_000_000,
      file_count: 95,
      files_completed: 95,
      article_count: 20_000,
      articles_downloaded: 20_000,
      articles_failed: 0,
      added_at: '2026-01-20T08:00:00Z',
      completed_at: null,
      speed_bps: 0,
      error_message: null,
      server_stats: [
        { server_id: '1', server_name: 'Primary', articles_downloaded: 20_000, articles_failed: 0, bytes_downloaded: 8.1e9 },
      ],
    },
    {
      id: `${DEMO_JOB_PREFIX}5`,
      name: 'Documentary.2025.720p.AAC.x264-TL',
      category: 'doc',
      status: 'queued',
      priority: 0,
      total_bytes: 1_000_000_000,
      downloaded_bytes: 0,
      file_count: 3,
      files_completed: 0,
      article_count: 1_200,
      articles_downloaded: 0,
      articles_failed: 0,
      added_at: '2026-01-20T10:20:00Z',
      completed_at: null,
      speed_bps: 0,
      error_message: null,
      server_stats: [],
    },
];


const PRIORITY_LEVELS = [
  { v: 0, label: 'Low' },
  { v: 1, label: 'Normal' },
  { v: 2, label: 'High' },
  { v: 3, label: 'Force' },
] as const;

type QueueSortField = 'remaining' | 'name' | 'size' | 'age' | 'priority';

const SORT_OPTIONS: readonly { label: string; field: QueueSortField; direction: 'asc' | 'desc' }[] = [
  { label: 'Priority (high first)', field: 'priority', direction: 'desc' },
  { label: 'Remaining (smallest first)', field: 'remaining', direction: 'asc' },
  { label: 'Size (smallest first)', field: 'size', direction: 'asc' },
  { label: 'Age (oldest first)', field: 'age', direction: 'asc' },
  { label: 'Name (A–Z)', field: 'name', direction: 'asc' },
];

interface BulkActionResponse {
  succeeded: number;
  failed: number;
  failures: { id: string; error: unknown }[];
}

@Component({
  selector: 'app-queue-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatSnackBarModule,
    MatBottomSheetModule,
    MatMenuModule,
    MatButtonModule,
    MatIconModule,
    DragDropModule,
  ],
  template: `
    <!-- ============ Stat cards ============ -->
    <div class="cards4">
      <div class="card premium-stat">
        <div class="label">Download speed</div>
        <div
          class="val val-premium tabular-nums stat-value--tick"
          [class.flash]="speedFlash()"
        >
          {{ speedValue() }} <span class="unit">{{ speedUnit() }}</span>
        </div>
        <div class="sub bullet" [class.sub-warn]="paused() && pauseReason() === 'disk_space'">
          <span>{{ speedLimitLabel() }}</span>
        </div>
        @if (sparklinePath()) {
          <svg class="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
            <path [attr.d]="sparklinePath()" fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke" />
          </svg>
        }
      </div>
      <div class="card">
        <div class="label">NNTP connections</div>
        <div class="val val-premium tabular-nums">{{ connsActive() }} / {{ connsTotal() }}</div>
        <div class="bar"><div [style.width.%]="connPct()"></div></div>
        <div class="sub bullet">
          <span>{{ displayServers().length }} server{{ displayServers().length === 1 ? '' : 's' }}</span>
          <span class="sep">·</span>
          <span>{{ serversEnabled() }} enabled</span>
        </div>
      </div>
      <div class="card">
        <div class="label">Queue</div>
        <div class="val val-premium tabular-nums">{{ displayJobs().length }} jobs · {{ formatBytes(displayRemainingBytes()) }}</div>
        <div class="sub bullet">
          <span class="tabular-nums">{{ etaTotal() }}</span>
        </div>
      </div>
      <div class="card">
        <div class="label">Disk free</div>
        <div class="val val-premium tabular-nums">{{ diskFreeValue() }} <span class="unit">{{ diskFreeUnit() }}</span></div>
        @if (diskTotalKnown()) {
          <div class="bar green"><div [style.width.%]="diskUsedPct()"></div></div>
          <div class="sub bullet">
            <span>{{ diskUsedPct() }}% used of {{ formatBytes(diskTotalBytes()) }}</span>
          </div>
        } @else {
          <div class="sub bullet">
            <span>Downloads volume</span>
          </div>
        }
      </div>
    </div>

    <!-- ============ Per-server connection pool ============ -->
    <div class="panel pool-panel" [class.collapsed]="poolCollapsed()">
      <h3>NNTP connection pool
        <span class="hint">priority failover · active transfers</span>
        <button
          type="button"
          class="collapse-btn"
          (click)="togglePool()"
          [title]="poolCollapsed() ? 'Expand' : 'Collapse'"
          [attr.aria-expanded]="!poolCollapsed()"
          aria-label="Toggle connection pool"
        >
          {{ poolCollapsed() ? '▸' : '▾' }}
        </button>
      </h3>
      @if (!poolCollapsed()) {
        <div class="body">
          @if (visibleServersWithConns().length === 0) {
            <div class="empty">
              @if (displayServers().length === 0) {
                No servers configured. <a routerLink="/settings">Add one →</a>
              } @else {
                No enabled servers in the connection pool.
              }
            </div>
          }
          @for (s of visibleServersWithConns(); track s.id) {
            <div class="srv-block">
              <div class="srv-head">
                <div>
                  <span class="srv-name" [title]="s.name || s.host">{{ s.name || s.host }}</span>
                  <span class="prio">priority {{ s.priority }} · {{ s.connections }} slots</span>
                </div>
                <div class="srv-meta tabular-nums">
                  {{ s.active }} {{ s.recent ? 'recent' : 'connected' }} · {{ s.connections - s.active }} free
                </div>
              </div>
              <div class="conn-grid">
                @for (i of gridRange(s.connections); track i) {
                  <div
                    class="c"
                    [class.active]="i < s.active && !s.recent"
                    [class.recent]="i < s.active && s.recent"
                  ></div>
                }
              </div>
            </div>
          }
          <div class="legend">
            <span class="sw a">Transferring now</span>
            <span class="sw r">Recent (held 5s)</span>
            <span class="sw f">Free slot</span>
            <span class="transport">{{ transportLabel() }}</span>
          </div>
        </div>
      }
    </div>

    @if (inDummyMode()) {
      <div class="dummy-banner" role="status">
        <span>Sample queue (not real downloads). For layout preview only.</span>
        <button type="button" class="btn sm ghost" (click)="dismissDummyPreview()">Hide</button>
      </div>
    }

    <!-- ============ Post-processing pipeline (shown when a job is in PP) ============ -->
    @if (ppJob(); as pp) {
      <div class="panel panel-pp">
        <h3>
          <span class="pp-head-line">Post-processing</span>
          <code class="pp-title-code" [attr.title]="pp.name">{{ pp.name }}</code>
          <span class="hint pp-head-status">{{ displayStatus(pp.status) }}</span>
        </h3>
        <div class="pipeline">
          @for (step of ppSteps(); track step.label) {
            <div class="step" [class.done]="step.state === 'done'" [class.active]="step.state === 'active'">
              <div class="dot">{{ stepIcon(step) }}</div>
              <div class="lbl">{{ step.label }}</div>
            </div>
          }
        </div>
      </div>
    }

    <!-- ============ Filter + bulk ============ -->
    <div class="queue-toolbar">
      <div class="filter-chips" role="group" aria-label="Filter queue">
        <button type="button" class="chip" [class.active]="filterStatus === 'all'" [attr.aria-pressed]="filterStatus === 'all'" (click)="filterStatus = 'all'">
          All ({{ displayJobs().length }})
        </button>
        <button type="button" class="chip" [class.active]="filterStatus === 'active'" [attr.aria-pressed]="filterStatus === 'active'" (click)="filterStatus = 'active'">
          Active ({{ countJobs('active') }})
        </button>
        <button type="button" class="chip" [class.active]="filterStatus === 'queued'" [attr.aria-pressed]="filterStatus === 'queued'" (click)="filterStatus = 'queued'">
          Queued ({{ countJobs('queued') }})
        </button>
        <button type="button" class="chip" [class.active]="filterStatus === 'paused'" [attr.aria-pressed]="filterStatus === 'paused'" (click)="filterStatus = 'paused'">
          Paused ({{ countJobs('paused') }})
        </button>
      </div>
      <button
        mat-icon-button
        type="button"
        [matMenuTriggerFor]="sortMenu"
        [disabled]="jobs().length < 2"
        aria-label="Sort queue"
        title="Sort queue"
      >
        <mat-icon>sort</mat-icon>
      </button>
      <mat-menu #sortMenu="matMenu">
        @for (opt of sortOptions; track opt.label) {
          <button mat-menu-item type="button" (click)="sortQueue(opt.field, opt.direction)">{{ opt.label }}</button>
        }
      </mat-menu>
      @if (selectedIds().size > 0) {
        <div class="bulk-bar">
          <span class="bulk-count">{{ selectedIds().size }} selected</span>
          <button type="button" class="btn sm" (click)="bulkResume()" [disabled]="paused()" [attr.title]="paused() ? 'Global pause is active' : null">Start</button>
          <button type="button" class="btn sm" (click)="bulkPause()">Pause</button>
          <button type="button" class="btn sm" [matMenuTriggerFor]="bulkPriorityMenu">Priority</button>
          <mat-menu #bulkPriorityMenu="matMenu">
            @for (p of priorityLevels; track p.v) {
              <button mat-menu-item type="button" (click)="bulkPriority(p.v)">{{ p.label }}</button>
            }
          </mat-menu>
          @if (categories().length > 0) {
            <button type="button" class="btn sm" [matMenuTriggerFor]="bulkCategoryMenu">Category</button>
            <mat-menu #bulkCategoryMenu="matMenu">
              @for (c of categories(); track c) {
                <button mat-menu-item type="button" (click)="bulkCategory(c)">{{ c }}</button>
              }
            </mat-menu>
          }
          <button type="button" class="btn sm danger" (click)="bulkDelete()">Delete</button>
          <button type="button" class="btn sm ghost" (click)="clearSelection()" aria-label="Clear selection">✕</button>
        </div>
      }
    </div>

    <div class="panel queue-tasks-panel">
      <h3>
        {{ filteredJobs().length }} task{{ filteredJobs().length === 1 ? '' : 's' }}
        <span class="hint">· {{ formatBytes(displayRemainingBytes()) }} remaining</span>
        @if (canDragInTable()) {
          <span class="hint dnd-hint" aria-hidden="true"
            >· {{ inDummyMode() ? 'drag to reorder (preview)' : 'drag to reorder' }}</span>
        }
        @if (paused()) {
          <span class="hint paused-hint" [class.warn]="pauseReason() === 'disk_space'">· {{ pausedLabel() }}</span>
        }
      </h3>
      <div class="body flush tbl-wrap">
        @if (loading() && displayJobs().length === 0) {
          <div class="empty-state empty-state--in-panel" role="status">
            <p>Loading…</p>
          </div>
        } @else if (filteredJobs().length === 0) {
          <div class="empty-state empty-state--tint empty-state--in-panel">
            <div class="empty-state__icon" aria-hidden="true">⬇</div>
            @if (displayJobs().length === 0) {
              <h3>Queue is empty</h3>
              <p>Tap <b>+</b> in the header to add an NZB.</p>
            } @else {
              <h3>No tasks match</h3>
              <p>Try another filter.</p>
            }
          </div>
        } @else {
          <div class="tbl-scroll">
            <table class="data tbl-queue">
              <thead>
                <tr>
                  <th class="q-th-drag" [class.q-th-drag--off]="!canDragInTable()"></th>
                  <th class="q-td-cb">
                    <span class="q-cb-wrap">
                      <input
                        class="q-cb"
                        type="checkbox"
                        aria-label="Select all visible jobs"
                        [checked]="allFilteredSelected()"
                        (change)="toggleSelectAll($event)"
                        [disabled]="filteredJobs().length === 0"
                      />
                    </span>
                  </th>
                  <th class="col-name">Name</th>
                  <th class="col-size">Size</th>
                  <th class="col-progress">Progress</th>
                  <th class="col-speed">Speed</th>
                  <th class="col-eta">ETA</th>
                  <th class="col-status">Status</th>
                  <th class="col-priority">Priority</th>
                  <th class="col-actions"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody
                cdkDropList
                [cdkDropListDisabled]="!canDragInTable()"
                (cdkDropListDropped)="onQueueDrop($event)"
              >
                @for (job of filteredJobs(); track job.id) {
                  <tr
                    cdkDrag
                    [cdkDragData]="job"
                    [cdkDragDisabled]="!canDragInTable()"
                    (contextmenu)="onRowContext($event, job)"
                  >
                    <td
                      class="q-td-drag"
                      [class.q-td-drag--off]="!canDragInTable()"
                      (click)="$event.stopPropagation()"
                    >
                      @if (canDragInTable()) {
                        <span
                          class="q-drag__inner q-drag__inner--active"
                          cdkDragHandle
                          [attr.aria-label]="'Reorder'"
                          [attr.title]="inDummyMode() ? 'Drag to reorder (sample queue)' : 'Drag to reorder'"
                        >
                          <mat-icon>drag_indicator</mat-icon>
                        </span>
                      } @else {
                        <span
                          class="q-drag__inner q-drag__inner--muted"
                          [attr.title]="
                            filterStatus !== 'all' ? 'Set filter to «All» to reorder' : 'No tasks to reorder'
                          "
                        >
                          <mat-icon>drag_indicator</mat-icon>
                        </span>
                      }
                    </td>
                    <td class="q-td-cb" (click)="$event.stopPropagation()">
                      <span class="q-cb-wrap">
                        <input
                          class="q-cb"
                          type="checkbox"
                          [attr.aria-label]="'Select ' + job.name"
                          [checked]="selectedIds().has(job.id)"
                          (change)="toggleSelected(job.id)"
                        />
                      </span>
                    </td>
                    <td
                      class="col-name cell-name--click"
                      [attr.title]="job.name"
                      (click)="$event.stopPropagation(); openJobSheet(job)"
                    >
                      <div class="job-name cell-ellipsis-block">{{ job.name }}</div>
                      @if (job.category) {
                        <div class="job-tags">
                          <span class="tag cat">{{ job.category }}</span>
                        </div>
                      }
                      @if (job.error_message) {
                        <div class="job-status-message" role="status" [title]="job.error_message">
                          {{ job.error_message }}
                        </div>
                      }
                    </td>
                    <td class="tabular-nums col-size" (click)="$event.stopPropagation()">
                      {{ formatBytes(job.total_bytes) }}
                    </td>
                    <td class="col-progress" (click)="$event.stopPropagation()">
                      <div
                        class="progress"
                        [class.pp]="isPostProc(rowStatus(job))"
                        [class.done]="rowStatus(job) === 'completed'"
                      >
                        <div [style.width.%]="percent(job)"></div>
                      </div>
                      <div class="prog-sub tabular-nums">
                        @if (isPostProc(job.status)) {
                          {{ displayStatus(job.status) }} · {{ percent(job) }}%
                        } @else {
                          {{ formatBytes(job.downloaded_bytes) }} / {{ formatBytes(job.total_bytes) }}
                        }
                      </div>
                      @if (job.articles_failed > 0) {
                        <div
                          class="article-failures"
                          title="Articles missing or otherwise failed after all download attempts"
                          role="status"
                        >
                          {{ failedArticlesLabel(job.articles_failed) }}
                        </div>
                      }
                    </td>
                    <td class="tabular-nums col-speed" (click)="$event.stopPropagation()">
                      {{ shouldShowLiveMetrics(job) && job.speed_bps > 0 ? formatSpeed(job.speed_bps) : '—' }}
                    </td>
                    <td class="tabular-nums col-eta" (click)="$event.stopPropagation()">
                      {{ shouldShowLiveMetrics(job) ? eta(job) : '—' }}
                    </td>
                    <td class="col-status" (click)="$event.stopPropagation()">
                      <span
                        class="status-pill"
                        [class]="statusClass(rowStatus(job))"
                        [attr.title]="
                          isDiskSpaceHold(job)
                            ? 'Waiting for free disk space; resumes automatically'
                            : null
                        "
                        >{{ statusLabel(job) }}</span
                      >
                    </td>
                    <td class="col-priority" (click)="$event.stopPropagation()">
                      <select
                        class="pri-pill"
                        [class.pri-pill--0]="job.priority === 0"
                        [class.pri-pill--1]="job.priority === 1"
                        [class.pri-pill--2]="job.priority === 2"
                        [class.pri-pill--3]="job.priority === 3"
                        [attr.aria-label]="'Priority of ' + job.name"
                        [disabled]="isDemoJob(job)"
                        (change)="setPriority(job, +$any($event.target).value)"
                      >
                        @for (p of priorityLevels; track p.v) {
                          <option [value]="p.v" [selected]="job.priority === p.v">{{ p.label }}</option>
                        }
                      </select>
                    </td>
                    <td class="actions col-actions" (click)="$event.stopPropagation()">
                      @if (rowStatus(job) === 'paused') {
                        <button
                          type="button"
                          class="row-action"
                          [disabled]="paused() || isDemoJob(job) || isActionPending(job.id)"
                          [title]="paused() ? 'Global pause is active' : 'Resume'"
                          aria-label="Resume"
                          (click)="resumeJob(job.id)"
                        >▶</button>
                      } @else if (rowStatus(job) !== 'completed' && rowStatus(job) !== 'failed') {
                        <button
                          type="button"
                          class="row-action"
                          [disabled]="paused() || isDemoJob(job) || isActionPending(job.id)"
                          [title]="paused() ? 'Global pause is active' : 'Pause'"
                          aria-label="Pause"
                          (click)="pauseJob(job.id)"
                        >❚❚</button>
                      } @else {
                        <button type="button" class="row-action" [disabled]="true" aria-hidden="true">—</button>
                      }
                      <button
                        type="button"
                        class="row-action danger"
                        [disabled]="isDemoJob(job) || isActionPending(job.id)"
                        title="Remove"
                        aria-label="Remove"
                        (click)="deleteJob(job)"
                      >✕</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Phone: one card-style row per job instead of a squeezed table. -->
          <ul
            class="q-list"
            cdkDropList
            [cdkDropListDisabled]="!canDragInTable()"
            (cdkDropListDropped)="onQueueDrop($event)"
          >
            @for (job of filteredJobs(); track job.id) {
              <li class="q-li" cdkDrag [cdkDragData]="job" [cdkDragDisabled]="!canDragInTable()">
                @if (canDragInTable()) {
                  <span class="q-li__drag" cdkDragHandle aria-label="Reorder">
                    <mat-icon>drag_indicator</mat-icon>
                  </span>
                }
                <input
                  class="q-cb q-li__cb"
                  type="checkbox"
                  [attr.aria-label]="'Select ' + job.name"
                  [checked]="selectedIds().has(job.id)"
                  (change)="toggleSelected(job.id)"
                />
                <button type="button" class="q-li__main" (click)="openJobSheet(job)">
                  <span class="q-li__name job-name">{{ job.name }}</span>
                  <span class="q-li__meta">
                    <span
                      class="status-pill"
                      [class]="statusClass(rowStatus(job))"
                      >{{ statusLabel(job) }}</span
                    >
                    @if (job.category) {
                      <span class="tag cat">{{ job.category }}</span>
                    }
                    @if (job.priority !== 1) {
                      <span class="q-li__prio">{{ priorityLabel(job.priority) }}</span>
                    }
                  </span>
                  <span
                    class="progress q-li__bar"
                    [class.pp]="isPostProc(rowStatus(job))"
                    [class.done]="rowStatus(job) === 'completed'"
                  >
                    <span class="q-li__fill" [style.width.%]="percent(job)"></span>
                  </span>
                  <span class="q-li__sub tabular-nums">
                    @if (isPostProc(job.status)) {
                      {{ displayStatus(job.status) }} · {{ percent(job) }}%
                    } @else {
                      {{ formatBytes(job.downloaded_bytes) }} / {{ formatBytes(job.total_bytes) }}
                    }
                    @if (shouldShowLiveMetrics(job) && job.speed_bps > 0) {
                      · {{ formatSpeed(job.speed_bps) }} · {{ eta(job) }}
                    }
                  </span>
                  @if (job.articles_failed > 0) {
                    <span class="article-failures">{{ failedArticlesLabel(job.articles_failed) }}</span>
                  }
                  @if (job.error_message) {
                    <span class="job-status-message">{{ job.error_message }}</span>
                  }
                </button>
                @if (rowStatus(job) === 'paused') {
                  <button
                    type="button"
                    class="q-li__act"
                    [disabled]="paused() || isDemoJob(job) || isActionPending(job.id)"
                    [attr.aria-label]="'Resume ' + job.name"
                    (click)="resumeJob(job.id)"
                  ><mat-icon>play_arrow</mat-icon></button>
                } @else if (rowStatus(job) !== 'completed' && rowStatus(job) !== 'failed') {
                  <button
                    type="button"
                    class="q-li__act"
                    [disabled]="paused() || isDemoJob(job) || isActionPending(job.id)"
                    [attr.aria-label]="'Pause ' + job.name"
                    (click)="pauseJob(job.id)"
                  ><mat-icon>pause</mat-icon></button>
                }
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
  styles: [`
    /* Compact queue page — roughly 20% smaller than app default. */
    :host {
      display: block;
      font-size: 11.2px;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }
    .dnd-hint {
      color: var(--mute);
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
    }
    .queue-tasks-panel h3 {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 8px;
    }
    .queue-tasks-panel h3 .hint {
      margin-left: 0;
    }
    .queue-tasks-panel h3 .paused-hint {
      margin-left: auto;
    }
    .q-th-drag {
      width: 36px;
      min-width: 36px;
      padding-left: 8px !important;
    }
    .q-th-drag--off {
      width: 10px;
      min-width: 10px;
      padding: 0 !important;
    }
    .q-td-drag {
      vertical-align: middle;
      width: 36px;
      min-width: 36px;
      padding: 6px 4px 6px 8px !important;
    }
    .q-td-cb {
      vertical-align: middle;
      width: 36px;
      min-width: 36px;
      padding: 6px 4px 6px 8px !important;
    }
    .q-cb-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 20px;
    }
    .q-cb {
      width: 18px;
      height: 18px;
      margin: 0;
    }
    .q-td-drag--off {
      width: 10px;
      min-width: 10px;
    }
    .q-drag__inner {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--mute);
      border-radius: 6px;
      padding: 2px;
      line-height: 0;
    }
    .q-drag__inner--active {
      cursor: grab;
      touch-action: none;
    }
    .q-drag__inner--active:hover {
      color: var(--tint);
      background: color-mix(in srgb, var(--tint) 10%, transparent);
    }
    .q-drag__inner--active:active {
      cursor: grabbing;
    }
    .q-drag__inner mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .q-drag__inner--muted {
      cursor: not-allowed;
      opacity: 0.45;
    }
    :host ::ng-deep tr.cdk-drag-preview {
      display: table-row;
      background: var(--card);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      border: 1px solid var(--line);
    }
    :host ::ng-deep tbody .cdk-drag-placeholder {
      opacity: 0.35;
      background: var(--panel2);
    }
    .cell-name--click {
      cursor: pointer;
    }
    .cell-name--click:hover {
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, var(--tint) 60%, transparent);
    }
    .empty-state--in-panel {
      padding: 28px 16px 32px;
      margin: 0;
    }
    .tbl-scroll {
      max-width: 100%;
      overflow-x: auto;
      overflow-y: visible;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-x: contain;
      padding-bottom: 4px;
    }
    :host ::ng-deep .tbl-queue {
      table-layout: fixed;
      width: 100%;
      min-width: 640px;
    }
    :host ::ng-deep .tbl-queue .col-name {
      width: auto;
    }
    /* Border-box widths: the number is the whole column, padding included. */
    :host ::ng-deep .tbl-queue th { box-sizing: border-box; }
    :host ::ng-deep .tbl-queue th.q-th-drag,
    :host ::ng-deep .tbl-queue th.q-td-cb { width: 40px; }
    :host ::ng-deep .tbl-queue th.col-size { width: 80px; }
    :host ::ng-deep .tbl-queue th.col-progress { width: 140px; }
    :host ::ng-deep .tbl-queue th.col-speed { width: 88px; }
    :host ::ng-deep .tbl-queue th.col-eta { width: 72px; }
    :host ::ng-deep .tbl-queue th.col-status { width: 112px; }
    :host ::ng-deep .tbl-queue th.col-priority { width: 112px; }
    :host ::ng-deep .tbl-queue th.col-actions { width: 76px; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    :host ::ng-deep .tbl-queue .q-th-drag,
    :host ::ng-deep .tbl-queue .q-td-drag {
      width: 36px;
    }
    :host ::ng-deep .tbl-queue .q-td-cb {
      width: 36px;
      min-width: 36px;
    }
    :host ::ng-deep .tbl-queue .cell-ellipsis {
      max-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .col-speed,
    .col-eta {
      white-space: nowrap;
    }
    .queue-tasks-panel {
      overflow: hidden;
    }
    :host ::ng-deep .queue-tasks-panel .tbl-queue .col-name {
      direction: ltr;
      text-align: start;
    }
    :host ::ng-deep .queue-tasks-panel .tbl-queue tbody tr {
      transition: background 0.12s ease;
    }
    :host ::ng-deep .queue-tasks-panel .tbl-queue tbody tr:hover td {
      background: color-mix(in srgb, var(--tint) 6%, transparent);
    }
    :host ::ng-deep .queue-tasks-panel .tbl-queue td {
      padding-top: 10px;
      padding-bottom: 10px;
    }
    :host ::ng-deep .queue-tasks-panel .q-td-drag {
      border-right: 1px solid var(--line);
    }
    .pri-pill {
      display: inline-block;
      font: var(--font-caption);
      font-weight: 600;
      padding: 4px 9px;
      border-radius: 8px;
      border: 1px solid var(--line);
      color: var(--text-secondary);
      background: var(--panel2);
      white-space: nowrap;
    }
    :host .pri-pill--3 {
      color: #fff;
      background: color-mix(in srgb, var(--tint) 50%, #1a1a20);
      border-color: color-mix(in srgb, var(--tint) 70%, var(--line));
    }
    :host .pri-pill--2 {
      color: var(--text);
      border-color: color-mix(in srgb, var(--accent2) 50%, var(--line));
      background: color-mix(in srgb, var(--accent2) 16%, var(--panel2));
    }
    :host .pri-pill--1 {
      color: var(--text);
    }
    :host .pri-pill--0 {
      opacity: 0.92;
    }
    .pp-title-code {
      display: block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      margin-top: 4px;
    }
    .panel-pp h3 {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      line-height: 1.3;
    }
    .pp-head-line {
      font: inherit;
      color: var(--text-secondary);
    }
    .pp-head-status {
      margin-left: 0;
      margin-top: 0;
    }
    @media (min-width: 1024px) {
      .pp-title-code {
        display: inline;
        max-width: min(42vw, 400px);
        margin-top: 0;
        font-size: inherit;
        vertical-align: bottom;
      }
      .panel-pp h3 {
        flex-direction: row;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px 10px;
      }
      .pp-head-line::after {
        content: " ·";
        color: var(--line);
        font-weight: 400;
      }
    }
    :host ::ng-deep .cards4 { gap: 12px; margin-bottom: 14px; }
    :host ::ng-deep .card { padding: 10px; border-radius: 6px; }
    :host ::ng-deep .card .label { font-size: 10px; }
    :host ::ng-deep .card .val { font-size: 17px; margin-top: 4px; }
    :host ::ng-deep .card .val.val-premium { font: var(--font-title2); font-size: 19px; }
    :host ::ng-deep .card .val .unit { font-size: 11px; }
    :host ::ng-deep .card .sub { font-size: 10px; margin-top: 3px; }
    :host ::ng-deep .panel { margin-bottom: 12px; border-radius: 6px; }
    :host ::ng-deep .panel h3 { padding: 9px 13px; font-size: 12px; }
    :host ::ng-deep .panel h3 .hint { font-size: 10px; }
    :host ::ng-deep .panel .body { padding: 11px 13px; }
    :host ::ng-deep table.data { font-size: 11.5px; }
    :host ::ng-deep table.data th { font-size: 10px; padding: 6px 10px; }
    :host ::ng-deep table.data td { padding: 6px 10px; }
    :host ::ng-deep .status-pill { font-size: 10px; padding: 1px 6px; }
    :host ::ng-deep .tag { font-size: 10px; padding: 0 5px; }
    :host ::ng-deep .progress { width: 100%; max-width: 120px; height: 5px; }

    /* Connection pool — heavily compacted per design feedback. */
    .panel.pool-panel { font-size: 10.5px; }
    .panel.pool-panel h3 { padding: 6px 10px; font-size: 11px; }
    .panel.pool-panel .body { padding: 8px 10px; }
    .panel.pool-panel.collapsed h3 { border-bottom: none; }
    .collapse-btn {
      background: none; border: none; cursor: pointer; color: var(--mute);
      font-size: 13px; padding: 0 4px; margin-left: 4px; line-height: 1;
    }
    .collapse-btn:hover { color: var(--text); }
    .srv-block { padding: 6px 0; border-bottom: 1px solid var(--line); }
    .srv-block:last-of-type { border: none; padding-bottom: 0; }
    .srv-block:first-of-type { padding-top: 0; }
    .srv-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .srv-name { font-weight: 600; font-size: 11px; }
    .srv-name.dim { color: var(--mute); }
    .prio { color: var(--mute); font-weight: 400; font-size: 10px; margin-left: 6px; }
    .srv-meta { color: var(--mute); font-size: 10px; }
    .conn-grid { display: grid; grid-template-columns: repeat(40, 1fr); gap: 2px; }
    .conn-grid .c { height: 8px; border-radius: 1px; background: var(--panel2); }
    .conn-grid .c.active { background: var(--accent2); }
    .legend { display: flex; gap: 10px; font-size: 10px; color: var(--mute); margin-top: 6px; align-items: center; }
    .legend .sw { display: inline-flex; align-items: center; }
    .legend .transport { margin-left: auto; }
    .legend .sw::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }
    .legend .a::before { background: var(--accent2); }
    .legend .f::before { background: var(--panel2); border: 1px solid var(--line); }
    .empty { color: var(--mute); font-size: 13px; padding: 4px 0; }
    .empty a { margin-left: 4px; }

    /* Post-processing pipeline (horizontal on desktop, stacked on phone) */
    .pipeline {
      display: flex;
      align-items: flex-start;
      gap: 0;
      padding: 14px 16px;
      background: var(--panel2);
      border-radius: 6px;
      margin: 0 0 12px;
      border: 1px solid var(--line);
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    .pipeline .step {
      flex: 1 1 0;
      min-width: 0;
      text-align: center;
      position: relative;
      padding: 4px 2px;
    }
    .pipeline .step .dot {
      width: 26px; height: 26px; border-radius: 50%;
      background: var(--panel); border: 2px solid var(--line);
      margin: 0 auto 6px; display: flex; align-items: center; justify-content: center;
      font-size: 12px; color: var(--mute); font-weight: 600;
    }
    .pipeline .step.done .dot {
      background: var(--accent2); border-color: var(--accent2); color: #fff;
    }
    .pipeline .step.active .dot {
      background: var(--tint); border-color: var(--tint); color: #fff;
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--tint) 25%, transparent);
    }
    .pipeline .step .lbl {
      font-size: 10px;
      color: var(--mute);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      line-height: 1.2;
      word-break: break-word;
      hyphens: auto;
    }
    @media (min-width: 1024px) {
      .pipeline .step .lbl { font-size: 11px; letter-spacing: 0.4px; }
    }
    .pipeline .step.done .lbl, .pipeline .step.active .lbl { color: var(--text); }
    .pipeline .step:not(:last-child)::after {
      content: "";
      position: absolute;
      top: 17px;
      right: -50%;
      left: 50%;
      height: 2px;
      background: var(--line);
      z-index: 0;
    }
    .pipeline .step.done::after { background: var(--accent2); }
    @media (max-width: 1023px) {
      .panel-pp h3 { padding: 10px 12px 6px; }
      .pipeline {
        flex-direction: column;
        align-items: stretch;
        padding: 6px 12px 12px;
        margin: 0 0 10px;
      }
      .pipeline .step {
        flex: none;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
        text-align: left;
        padding: 10px 0;
        width: 100%;
        min-width: 0;
        min-height: 44px;
        box-sizing: border-box;
        position: relative;
      }
      .pipeline .step:not(:last-of-type) {
        border-bottom: 1px solid var(--line);
      }
      .pipeline .step .dot {
        margin: 0 12px 0 0;
        flex-shrink: 0;
      }
      .pipeline .step.active .dot {
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--tint) 22%, transparent);
      }
      .pipeline .step .lbl {
        text-transform: none;
        letter-spacing: 0;
        font-size: 12px;
        line-height: 1.3;
        flex: 1;
        min-width: 0;
        word-break: break-word;
      }
      .pipeline .step:not(:last-child)::after {
        display: none;
      }
    }

    /* Toolbar + inset queue */
    .queue-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    .filter-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .chip {
      padding: 8px 14px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      font: var(--font-footnote);
      min-height: 36px;
    }
    .chip.active {
      border-color: var(--tint);
      color: var(--tint);
      background: color-mix(in srgb, var(--tint) 12%, transparent);
    }
    mat-icon.filter-active {
      color: var(--tint);
    }
    .bulk-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      width: 100%;
    }
    .bulk-count {
      color: var(--text-secondary);
      font: var(--font-subheadline);
    }
    @media (min-width: 1024px) {
    }
    .dummy-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 14px;
      margin-bottom: 14px;
      border-radius: var(--radius-card);
      background: color-mix(in srgb, var(--tint) 10%, var(--card));
      box-shadow: var(--card-elev);
      font: var(--font-subheadline);
      color: var(--text-secondary);
    }
    .actions {
      white-space: nowrap;
    }

    /* Mobile: remove horizontal scroll by hiding low-signal columns. */
    @media (max-width: 720px) {
      :host { font-size: 11px; }

      .queue-tasks-panel {
        overflow: visible;
      }
      .queue-tasks-panel .body.flush.tbl-wrap {
        padding-bottom: calc(16px + env(safe-area-inset-bottom, 0));
      }
      .tbl-scroll {
        padding-bottom: 14px;
      }

      :host ::ng-deep .tbl-queue {
        min-width: 0;
        table-layout: auto;
      }
      :host ::ng-deep table.data th { padding: 6px 8px; }
      :host ::ng-deep table.data td { padding: 8px 8px; }

      /* Hide: Speed, ETA, Priority, Actions */
      :host ::ng-deep .tbl-queue th:nth-child(6),
      :host ::ng-deep .tbl-queue td:nth-child(6),
      :host ::ng-deep .tbl-queue th:nth-child(7),
      :host ::ng-deep .tbl-queue td:nth-child(7),
      :host ::ng-deep .tbl-queue th:nth-child(9),
      :host ::ng-deep .tbl-queue td:nth-child(9),
      :host ::ng-deep .tbl-queue th:nth-child(10),
      :host ::ng-deep .tbl-queue td:nth-child(10) {
        display: none;
      }

      /* Reduce drag + checkbox footprint */
      :host ::ng-deep .tbl-queue .q-th-drag,
      :host ::ng-deep .tbl-queue .q-td-drag {
        width: 28px;
        min-width: 28px;
        padding-left: 6px !important;
        padding-right: 2px !important;
      }
      :host ::ng-deep .tbl-queue .q-td-cb {
        width: 34px;
        min-width: 34px;
        padding-left: 4px !important;
        padding-right: 4px !important;
      }

      /* Make name breathe; keep progress compact */
      :host ::ng-deep .tbl-queue .col-name { width: 52%; }
      :host ::ng-deep .tbl-queue th.col-size { width: auto; }
      :host ::ng-deep .tbl-queue th.col-progress { width: 96px; }
      :host ::ng-deep .tbl-queue th.col-status { width: auto; }
      :host ::ng-deep .progress { width: 92px; }
      :host ::ng-deep .status-pill { max-width: 90px; }

      /* One swipeable row of filter chips instead of wrapping. */
      .filter-chips {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        margin: 0 -4px;
        padding: 0 4px;
      }
      .filter-chips::-webkit-scrollbar { display: none; }
      .chip { flex-shrink: 0; white-space: nowrap; }

      :host ::ng-deep .card .val.val-premium { font-size: 17px; }
      .pool-panel h3 .hint { display: none; }
      .legend { flex-wrap: wrap; row-gap: 4px; }
      .legend .transport { display: none; }
    }

    /* Phone list (replaces the table below 720px). */
    .q-list { display: none; list-style: none; margin: 0; padding: 0; }
    @media (max-width: 720px) {
      .tbl-scroll { display: none; }
      .q-list { display: block; }
      .queue-toolbar { flex-wrap: nowrap; }
      .bulk-bar { order: 3; }
      .queue-toolbar:has(.bulk-bar) { flex-wrap: wrap; }
    }
    .q-li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 10px 6px;
      border-bottom: 1px solid var(--line);
      background: var(--card);
    }
    .q-li:last-child { border-bottom: none; }
    .q-li.cdk-drag-preview {
      border-radius: var(--radius-row);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    }
    .q-li.cdk-drag-placeholder { opacity: 0.3; }
    .q-list.cdk-drop-list-dragging .q-li:not(.cdk-drag-placeholder) {
      transition: transform 0.2s ease;
    }
    .q-li__drag {
      display: inline-flex;
      color: var(--mute);
      touch-action: none;
      cursor: grab;
      padding: 6px 0;
    }
    .q-li__drag mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .q-li__cb { flex-shrink: 0; }
    .q-li__main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }
    .q-li__name {
      font: var(--font-subheadline);
      font-weight: 600;
      color: var(--text);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }
    .q-li__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .q-li__prio { font: var(--font-caption); color: var(--text-secondary); }
    :host ::ng-deep .progress.q-li__bar { display: block; width: 100%; max-width: none; height: 4px; }
    .q-li__fill { display: block; height: 100%; background: var(--tint); transition: width 0.3s; }
    .q-li__bar.pp .q-li__fill { background: var(--purple); }
    .q-li__bar.done .q-li__fill { background: var(--accent2); }
    .q-li__sub { font: var(--font-caption); color: var(--mute); }
    .q-li .article-failures,
    .q-li .job-status-message { font: var(--font-caption); white-space: normal; }
    .q-li__act {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: color-mix(in srgb, var(--tint) 14%, var(--panel2));
      color: var(--tint);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .q-li__act:disabled { opacity: 0.35; cursor: not-allowed; }

    /* Upstream additions rendered in the compact queue design. */
    .sub-warn { color: var(--warn); }
    .paused-hint { color: var(--text-secondary); }
    .paused-hint.warn { color: var(--warn); }
    .conn-grid .c.recent {
      background: color-mix(in srgb, var(--accent2) 45%, var(--panel2));
    }
    .legend .r::before { background: color-mix(in srgb, var(--accent2) 45%, var(--panel2)); }
    .col-name .cell-ellipsis-block {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    :host ::ng-deep .tbl-queue td.col-name {
      max-width: 0;
    }
    .job-tags { margin-top: 3px; }
    .job-status-message {
      margin-top: 3px;
      color: var(--danger);
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .prog-sub {
      margin-top: 3px;
      color: var(--mute);
      font-size: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    :host ::ng-deep .tbl-queue .article-failures { text-align: left; }
    select.pri-pill {
      cursor: pointer;
      font-family: inherit;
    }
    select.pri-pill:disabled { cursor: default; }
    select.pri-pill option {
      color: var(--text);
      background: var(--card);
    }
  `],

})
export class QueueViewComponent implements OnInit, OnDestroy {
  loading = signal(true);
  jobs = signal<NzbJob[]>([]);
  remainingBytes = signal(0);
  servers = signal<ServerConfigLite[]>([]);
  status = signal<StatusResponse | null>(null);
  selectedIds = signal<Set<string>>(new Set());
  paused: WritableSignal<boolean>;
  /** Why the queue is globally paused, from the last queue refresh. */
  pauseReason = signal<PauseReason | null>(null);
  actionPendingIds = signal<Set<string>>(new Set());
  draggingJobId = signal<string | null>(null);
  dropAfterTarget = signal(false);
  reorderPending = signal(false);
  /** When the real queue is empty, show filled sample rows (can be turned off in localStorage). */
  readonly showQueueDummy = signal(this.readQueueDummyPref());
  /** Last ~30 global speed samples for the sparkline. */
  speedHistory = signal<number[]>([]);
  speedFlash = signal(false);
  private lastSpeedBps = 0;

  readonly priorityLevels = PRIORITY_LEVELS;
  readonly sortOptions = SORT_OPTIONS;
  categories = signal<string[]>([]);

  /** When showing the sample queue, id order after drag (preview only); `null` = default. */
  private readonly demoIdOrder = signal<string[] | null>(null);

  readonly POOL_KEY = 'rustnzb.poolPanelCollapsed';
  poolCollapsed = signal(localStorage.getItem('rustnzb.poolPanelCollapsed') === 'true');

  togglePool(): void {
    const next = !this.poolCollapsed();
    this.poolCollapsed.set(next);
    localStorage.setItem(this.POOL_KEY, String(next));
  }

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private queueRequestSeq = 0;
  // Polls started before this sequence finished must not apply their response:
  // a snapshot taken mid-reorder/delete would resurrect rows (BUG-126).
  private queueStaleThrough = 0;
  private connectionHoldTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly connectionHold = new Map<string, { count: number; expiresAt: number }>();
  connectionClock = signal(Date.now());

  // Filter
  filterStatus: 'all' | 'active' | 'queued' | 'paused' = 'all';

  constructor(
    private api: ApiService,
    private snackBar: MatSnackBar,
    private bottomSheet: MatBottomSheet,
    private confirmSvc: ConfirmService,
    pauseState: PauseStateService,
  ) {
    this.paused = pauseState.paused;
  }

  ngOnInit(): void {
    this.loadAll();
    this.pollTimer = setInterval(() => {
      this.fetchQueue(false);
      this.loadStatus();
    }, 2000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.connectionHoldTimer) clearTimeout(this.connectionHoldTimer);
  }

  // ---- Sample (preview) queue ----

  /** Jobs shown in the list: real from API, or sample data when the queue is empty. */
  readonly displayJobs = computed((): NzbJob[] => {
    if (this.jobs().length > 0) return this.jobs();
    if (this.showQueueDummy() && !this.loading()) {
      const custom = this.demoIdOrder();
      if (custom && custom.length > 0) {
        const byId = new Map(DEMO_QUEUE_JOBS.map((j): [string, NzbJob] => [j.id, j]));
        return custom.map((id) => byId.get(id)).filter((j): j is NzbJob => j != null);
      }
      return [...DEMO_QUEUE_JOBS];
    }
    return [];
  });

  readonly inDummyMode = computed(
    () => this.jobs().length === 0 && this.showQueueDummy() && !this.loading(),
  );

  /** Servers: real, or a single placeholder row in preview mode when there are no servers. */
  readonly displayServers = computed((): ServerConfigLite[] => {
    const s = this.servers();
    if (s.length > 0) return s;
    if (this.inDummyMode()) return [DEMO_SRV];
    return s;
  });

  readonly displayRemainingBytes = computed(() => {
    if (this.jobs().length > 0) return this.normalizeNonNegative(this.remainingBytes());
    if (this.inDummyMode()) {
      return DEMO_QUEUE_JOBS.reduce((sum, j) => sum + this.remainingForJob(j), 0);
    }
    return 0;
  });

  readonly displaySpeedBps = computed(() => {
    if (this.inDummyMode()) return Math.round(12.4 * 1024 * 1024);
    return this.normalizeNonNegative(this.status()?.speed_bps ?? 0);
  });

  readonly displayDiskFreeBytes = computed(() => {
    if (this.inDummyMode() && !this.status()) return 450 * 1024 ** 3;
    return this.normalizeNonNegative(this.status()?.disk_space_free ?? 0);
  });

  readonly sparklinePath = computed(() => {
    if (this.inDummyMode()) return this.sparklineDummyPath();
    const h = this.speedHistory();
    if (h.length < 2) return '';
    const max = Math.max(...h, 1e-6);
    const w = 100;
    const innerH = 30;
    return h
      .map((v, i) => {
        const x = (i / (h.length - 1)) * w;
        const y = innerH - (v / max) * innerH + 1;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  });

  dismissDummyPreview(): void {
    try {
      localStorage.setItem('rustnzb.queueShowDummy', 'false');
    } catch {
      /* storage unavailable: hide for this visit only */
    }
    this.showQueueDummy.set(false);
    this.demoIdOrder.set(null);
  }

  isDemoJob(job: NzbJob): boolean {
    return job.id.startsWith(DEMO_JOB_PREFIX);
  }

  private readQueueDummyPref(): boolean {
    try {
      // Opt-in only: fake rows in an empty queue read as real jobs that
      // cannot be paused, removed or opened.
      return localStorage.getItem('rustnzb.queueShowDummy') === 'true';
    } catch {
      return false;
    }
  }

  private sparklineDummyPath(): string {
    const w = 100;
    const innerH = 30;
    const parts: string[] = [];
    for (let i = 0; i < 24; i++) {
      const x = (i / 23) * w;
      const y = innerH / 2 - Math.sin(i * 0.42) * (innerH * 0.35) + 2;
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return parts.join(' ');
  }

  // ---- Job sheet ----

  openJobSheet(job: NzbJob): void {
    if (this.isDemoJob(job)) {
      this.snackBar.open('Sample row only — add a real NZB to open job details.', 'Close', {
        duration: 4000,
      });
      return;
    }
    const idx = this.jobs().findIndex((j) => j.id === job.id);
    const data: QueueJobSheetData = { job, index: idx >= 0 ? idx : 0, total: this.jobs().length };
    const ref = this.bottomSheet.open(QueueJobSheetComponent, {
      data,
      panelClass: 'ruddarr-bottom-sheet',
    });
    ref.afterDismissed().subscribe((r) => {
      if (r === 'refresh') this.loadQueue();
    });
  }

  onRowContext(ev: MouseEvent, job: NzbJob): void {
    ev.preventDefault();
    this.openJobSheet(job);
  }

  // ---- Loading ----

  private loadAll(): void {
    this.loadQueue();
    this.loadServers();
    this.loadCategories();
  }

  private loadCategories(): void {
    this.api.get<{ name: string }[]>('/config/categories').subscribe({
      next: (cats) => this.categories.set((cats ?? []).map((c) => c.name)),
      error: () => {},
    });
  }

  /**
   * Authoritative refresh after a mutation: supersedes every poll already in
   * flight, and refreshes the status snapshot.
   */
  loadQueue(): void {
    this.fetchQueue(true);
    this.loadStatus();
  }

  private loadStatus(): void {
    this.api.get<StatusResponse>('/status').subscribe({
      next: (s) => {
        this.status.set(s);
        this.updateConnectionHold(s?.nntp_connections ?? [], Date.now());
        this.recordSpeedSample(s?.speed_bps);
      },
      error: () => {},
    });
  }

  private fetchQueue(supersedeInFlight: boolean): void {
    const seq = ++this.queueRequestSeq;
    if (supersedeInFlight) this.queueStaleThrough = seq - 1;
    this.api.get<QueueResponse>('/queue').subscribe({
      next: (r) => {
        if (seq <= this.queueStaleThrough || this.reorderPending()) return;
        this.queueStaleThrough = seq;
        this.jobs.set(r.jobs);
        this.paused.set(r.paused);
        this.pauseReason.set(r.pause_reason ?? null);
        if (r.jobs.length > 0) this.demoIdOrder.set(null);
        this.remainingBytes.set(r.jobs.reduce((sum, j) => sum + this.remainingForJob(j), 0));
        // Prune selectedIds of jobs that no longer exist.
        const liveIds = new Set(r.jobs.map((j) => j.id));
        const cur = this.selectedIds();
        const next = new Set<string>();
        for (const id of cur) if (liveIds.has(id)) next.add(id);
        if (next.size !== cur.size) this.selectedIds.set(next);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private recordSpeedSample(speedBps: number | undefined): void {
    const sp = this.normalizeNonNegative(speedBps ?? 0);
    this.speedHistory.set([...this.speedHistory(), sp].slice(-30));
    if (sp !== this.lastSpeedBps) {
      this.lastSpeedBps = sp;
      this.speedFlash.set(true);
      setTimeout(() => this.speedFlash.set(false), 120);
    }
  }

  loadServers(): void {
    this.api.get<ServerConfigLite[]>('/config/servers').subscribe({
      next: (srvs) => this.servers.set(srvs),
      error: () => {},
    });
  }

  // ---- Stat-card derivations ----

  speedValue = computed(() => formatBytesParts(this.displaySpeedBps()).value);
  speedUnit = computed(() => `${formatBytesParts(this.displaySpeedBps()).unit}/s`);
  pausedLabel = computed(() =>
    this.pauseReason() === 'disk_space' ? 'Paused · low disk space' : 'Paused',
  );
  /** Sub-line of the speed card: pause state, else the configured limit (0 = off). */
  speedLimitLabel = computed(() => {
    if (this.paused()) return this.pausedLabel();
    const limit = this.status()?.speed_limit_bps ?? 0;
    return limit > 0 ? `Active · limit ${formatSpeed(limit)}` : 'Active · limit off';
  });
  diskFreeValue = computed(() => formatBytesParts(this.displayDiskFreeBytes()).value);
  diskFreeUnit = computed(() => formatBytesParts(this.displayDiskFreeBytes()).unit);
  diskTotalBytes = computed(() => this.normalizeNonNegative(this.status()?.disk_space_total ?? 0));
  diskTotalKnown = computed(() => this.diskTotalBytes() > 0);
  diskUsedPct = computed(() => {
    const total = this.diskTotalBytes();
    if (total <= 0) return 0;
    const free = this.normalizeNonNegative(this.status()?.disk_space_free ?? 0);
    const used = Math.max(0, total - free);
    return Math.min(100, Math.round((100 * used) / total));
  });

  serversEnabled = computed(() => this.displayServers().filter((s) => s.enabled).length);
  transportLabel = computed(() => {
    const enabled = this.displayServers().filter((s) => s.enabled);
    const tls = enabled.filter((s) => s.ssl).length;
    if (enabled.length === 0) return '';
    if (tls === enabled.length) return 'Transport: NNTPS · rustls';
    if (tls === 0) return 'Transport: plain NNTP';
    return 'Transport: NNTPS + plain NNTP';
  });
  connsTotal = computed(() =>
    this.displayServers()
      .filter((s) => s.enabled)
      .reduce((n, s) => n + s.connections, 0),
  );
  connsActive = computed(() =>
    this.visibleServersWithConns().reduce((total, server) => total + server.active, 0),
  );
  connPct = computed(() => {
    const t = this.connsTotal();
    return t === 0 ? 0 : Math.round((this.connsActive() / t) * 100);
  });

  /**
   * Live article transfers per enabled server. A just-finished non-zero value
   * is retained for five seconds and explicitly marked `recent` so short
   * backup cascades remain visible between two-second polling ticks.
   */
  visibleServersWithConns = computed(() => {
    this.connectionClock();
    const enabled = this.displayServers()
      .filter((s) => s.enabled)
      .sort((a, b) => a.priority - b.priority);
    return enabled.map((s) => {
      if (s.id === DEMO_SRV.id) return { ...s, active: 5, recent: false };
      const display = this.displayConnectionCount(s.id);
      return { ...s, active: Math.min(s.connections, display.count), recent: display.recent };
    });
  });

  updateConnectionHold(
    snapshots: ReadonlyArray<{ server_id: string; connected: number }>,
    now = Date.now(),
  ): void {
    for (const snapshot of snapshots) {
      if (snapshot.connected > 0) {
        this.connectionHold.set(snapshot.server_id, {
          count: snapshot.connected,
          expiresAt: now + CONNECTION_HOLD_MS,
        });
      }
    }
    this.connectionClock.set(now);
    this.scheduleConnectionHoldExpiry(now);
  }

  displayConnectionCount(serverId: string, now = this.connectionClock()): DisplayConnectionCount {
    const live = this.status()?.nntp_connections?.find((item) => item.server_id === serverId);
    if ((live?.connected ?? 0) > 0) return { count: live!.connected, recent: false };
    const held = this.connectionHold.get(serverId);
    if (held && held.expiresAt > now) return { count: held.count, recent: true };
    return { count: 0, recent: false };
  }

  private scheduleConnectionHoldExpiry(now: number): void {
    if (this.connectionHoldTimer) clearTimeout(this.connectionHoldTimer);
    const nextExpiry = Math.min(
      ...Array.from(this.connectionHold.values(), (held) => held.expiresAt).filter(
        (expiresAt) => expiresAt > now,
      ),
    );
    if (!Number.isFinite(nextExpiry)) return;
    this.connectionHoldTimer = setTimeout(() => {
      const expiredAt = Date.now();
      for (const [serverId, held] of this.connectionHold) {
        if (held.expiresAt <= expiredAt) this.connectionHold.delete(serverId);
      }
      this.connectionClock.set(expiredAt);
      this.scheduleConnectionHoldExpiry(expiredAt);
    }, Math.max(0, nextExpiry - now));
  }

  gridRange(n: number): number[] {
    return Array.from({ length: Math.max(0, n) }, (_, i) => i);
  }

  etaTotal(): string {
    const speed = this.displaySpeedBps();
    const remaining = this.normalizeNonNegative(this.displayRemainingBytes());
    if (speed <= 0 || remaining <= 0) return 'ETA —';
    return 'ETA ' + this.formatDuration(remaining / speed);
  }

  // ---- Post-processing pipeline ----

  ppJob = computed<NzbJob | null>(() => {
    return this.displayJobs().find((j) => this.isPostProc(j.status)) ?? null;
  });

  ppSteps = computed<PipelineStep[]>(() => {
    const job = this.ppJob();
    if (!job) return [];
    const order = ['download', 'decode', 'assemble', 'verify', 'repair', 'extract', 'cleanup'];
    const labels: Record<string, string> = {
      download: 'Download',
      decode: 'Decode',
      assemble: 'Assemble',
      verify: 'Par2 verify',
      repair: 'Par2 repair',
      extract: 'Unrar',
      cleanup: 'Cleanup',
    };
    const statusToIdx: Record<string, number> = {
      downloading: 0,
      verifying: 3,
      repairing: 4,
      extracting: 5,
      completed: 6,
    };
    const activeIdx = statusToIdx[job.status] ?? 0;
    return order.map((k, i) => ({
      label: labels[k],
      state: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
    }));
  });

  stepIcon(step: PipelineStep): string {
    if (step.state === 'done') return '✓';
    return String(this.ppSteps().indexOf(step) + 1);
  }

  isPostProc(status: string): boolean {
    return ['verifying', 'repairing', 'extracting'].includes(status);
  }

  // ---- Filtering ----

  /** Reordering needs the full, unfiltered list and something to reorder. */
  canReorderRows(): boolean {
    return this.filterStatus === 'all' && this.filteredJobs().length > 1;
  }

  canDragInTable(): boolean {
    return this.canReorderRows() && !this.reorderPending();
  }

  filteredJobs(): NzbJob[] {
    const all = this.displayJobs();
    if (this.filterStatus === 'all') return all;
    return all.filter((j) => this.matchesFilter(j, this.filterStatus));
  }

  countJobs(kind: 'active' | 'queued' | 'paused'): number {
    return this.displayJobs().filter((j) => this.matchesFilter(j, kind)).length;
  }

  private matchesFilter(job: NzbJob, kind: 'all' | 'active' | 'queued' | 'paused'): boolean {
    const status = this.effectiveStatus(job.status);
    if (kind === 'active') return status === 'downloading' || this.isPostProc(job.status);
    if (kind === 'queued') return status === 'queued';
    if (kind === 'paused') return status === 'paused';
    return true;
  }

  // ---- Per-job actions ----

  isActionPending(id: string): boolean {
    return this.actionPendingIds().has(id);
  }

  private withPendingJobAction(
    id: string,
    actionFactory: () => Observable<unknown>,
    successMessage?: string,
    failureMessage = 'Action failed',
  ): void {
    if (this.isActionPending(id)) return;

    const pending = new Set(this.actionPendingIds());
    pending.add(id);
    this.actionPendingIds.set(pending);

    actionFactory()
      .pipe(
        finalize(() => {
          const next = new Set(this.actionPendingIds());
          next.delete(id);
          this.actionPendingIds.set(next);
        }),
      )
      .subscribe({
        next: () => {
          if (successMessage) {
            this.snackBar.open(successMessage, 'Close', { duration: 2500 });
          }
          this.loadQueue();
        },
        error: (err) => {
          showHttpError(this.snackBar, err, failureMessage);
          this.loadQueue();
        },
      });
  }

  pauseJob(id: string): void {
    if (id.startsWith(DEMO_JOB_PREFIX)) return;
    this.withPendingJobAction(
      id,
      () => this.api.post(`/queue/${id}/pause`),
      'Job paused',
      'Failed to pause job',
    );
  }

  resumeJob(id: string): void {
    if (id.startsWith(DEMO_JOB_PREFIX)) return;
    // The backend enforces the same invariant. Keeping the guard here avoids
    // a misleading request/toast if stale DOM or keyboard input fires while
    // the global pause state is active.
    if (this.paused()) return;
    this.withPendingJobAction(
      id,
      () => this.api.post(`/queue/${id}/resume`),
      'Job resumed',
      'Failed to resume job',
    );
  }

  /** Plain priority change; it never preempts (moving a job to the top does). */
  setPriority(job: NzbJob, priority: number): void {
    if (this.isDemoJob(job) || priority === job.priority) return;
    this.api.put(`/queue/${job.id}/priority`, { priority }).subscribe({
      next: () => this.loadQueue(),
      error: (err) => {
        showHttpError(this.snackBar, err, 'Failed to change priority');
        this.loadQueue();
      },
    });
  }

  deleteJob(job: NzbJob): void {
    if (this.isDemoJob(job)) return;
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
        this.withPendingJobAction(
          job.id,
          () => this.api.delete(`/queue/${job.id}`),
          undefined,
          'Failed to remove job',
        );
      });
  }

  // ---- Reordering ----

  /** CDK drag-and-drop (mouse and touch) on the queue table. */
  onQueueDrop(event: CdkDragDrop<NzbJob>): void {
    const from = event.previousIndex;
    const to = event.currentIndex;
    if (from === to || this.filterStatus !== 'all') return;
    if (this.inDummyMode()) {
      const list = [...this.displayJobs()];
      if (from < 0 || from >= list.length) return;
      moveItemInArray(list, from, to);
      this.demoIdOrder.set(list.map((j) => j.id));
      return;
    }
    const list = this.jobs();
    const dragged = (event.item?.data as NzbJob | undefined) ?? list[from];
    const target = list[to];
    if (!dragged || !target) return;
    this.reorder(dragged.id, target.id, to > from);
  }

  /** Drop onto a row: `draggingJobId`/`dropAfterTarget` describe the gesture. */
  onRowDrop(event: DragEvent, targetJobId: string): void {
    event.preventDefault();

    const draggedId = this.draggingJobId();
    const dropAfter = this.dropAfterTarget();
    this.dropAfterTarget.set(false);
    if (!draggedId) return;
    this.reorder(draggedId, targetJobId, dropAfter);
  }

  onReorderEnd(): void {
    this.draggingJobId.set(null);
    this.dropAfterTarget.set(false);
  }

  /**
   * Optimistically move a job and persist its new position. Polls that land
   * while the move is pending are ignored, so the optimistic order sticks.
   * Moving to the top lets the backend preempt the running download.
   */
  private reorder(draggedId: string, targetJobId: string, placeAfter: boolean): void {
    if (draggedId === targetJobId || !this.canReorderRows() || this.reorderPending()) return;

    const previousJobs = this.jobs();
    const nextJobs = this.buildReorderedJobs(previousJobs, draggedId, targetJobId, placeAfter);
    if (!nextJobs) return;

    const targetIndex = nextJobs.findIndex((job) => job.id === draggedId);
    if (targetIndex < 0) return;

    this.reorderPending.set(true);
    this.jobs.set(nextJobs);
    this.api.post(`/queue/${draggedId}/move`, { position: targetIndex }).subscribe({
      next: () => {
        this.reorderPending.set(false);
        this.loadQueue();
      },
      error: (err) => {
        this.reorderPending.set(false);
        this.jobs.set(previousJobs);
        showHttpError(this.snackBar, err, 'Unable to reorder queue');
      },
    });
  }

  buildReorderedJobs(
    jobs: NzbJob[],
    draggedId: string,
    targetJobId: string,
    placeAfter: boolean,
  ): NzbJob[] | null {
    const draggedJob = jobs.find((job) => job.id === draggedId);
    if (!draggedJob) return null;

    const remainingJobs = jobs.filter((job) => job.id !== draggedId);
    const targetIndex = remainingJobs.findIndex((job) => job.id === targetJobId);
    if (targetIndex < 0) return null;

    const insertionIndex = targetIndex + (placeAfter ? 1 : 0);
    const nextJobs = [...remainingJobs];
    nextJobs.splice(insertionIndex, 0, draggedJob);
    return nextJobs;
  }

  /** Server-side sort of the whole queue; the next refresh shows the new order. */
  sortQueue(field: QueueSortField, direction: 'asc' | 'desc'): void {
    if (this.jobs().length < 2 || this.reorderPending()) return;
    this.api.post('/queue/sort', { sort_by: field, direction }).subscribe({
      next: () => this.loadQueue(),
      error: (err) => showHttpError(this.snackBar, err, 'Unable to sort queue'),
    });
  }

  // ---- Bulk ----

  toggleSelected(id: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIds.set(next);
  }
  clearSelection(): void {
    this.selectedIds.set(new Set());
  }
  allFilteredSelected(): boolean {
    const f = this.filteredJobs();
    if (f.length === 0) return false;
    const sel = this.selectedIds();
    return f.every((j) => sel.has(j.id));
  }
  toggleSelectAll(ev: Event): void {
    if ((ev.target as HTMLInputElement).checked) {
      this.selectedIds.set(new Set(this.filteredJobs().map((j) => j.id)));
    } else {
      this.clearSelection();
    }
  }

  private selectedRealIds(): string[] {
    return Array.from(this.selectedIds()).filter((id) => !id.startsWith(DEMO_JOB_PREFIX));
  }

  /**
   * Apply one action to every selected job with a single `/queue/bulk`
   * request, and report partial failures once with the first server message.
   */
  private runBulk(ids: string[], action: string, verb: string, value?: unknown): void {
    this.clearSelection();
    if (ids.length === 0) return;
    const body: Record<string, unknown> = { ids, action };
    if (value !== undefined) body['value'] = value;
    this.api.post<BulkActionResponse>('/queue/bulk', body).subscribe({
      next: (r) => {
        const failed = r?.failed ?? 0;
        if (failed > 0) {
          showHttpError(
            this.snackBar,
            r.failures?.[0] ?? null,
            `Failed to ${verb} ${failed} of ${ids.length} job(s)`,
          );
        }
        this.loadQueue();
      },
      error: (err) => {
        showHttpError(this.snackBar, err, `Failed to ${verb} ${ids.length} job(s)`);
        this.loadQueue();
      },
    });
  }
  bulkResume(): void {
    this.runBulk(this.selectedRealIds(), 'resume', 'resume');
  }
  bulkPause(): void {
    this.runBulk(this.selectedRealIds(), 'pause', 'pause');
  }
  bulkPriority(priority: number): void {
    this.runBulk(this.selectedRealIds(), 'priority', 'change priority of', priority);
  }
  bulkCategory(category: string): void {
    this.runBulk(this.selectedRealIds(), 'category', 'change category of', category);
  }
  bulkDelete(): void {
    const ids = this.selectedRealIds();
    if (ids.length === 0) {
      this.clearSelection();
      return;
    }
    this.confirmSvc
      .confirm({
        title: `Remove ${ids.length} job(s)?`,
        message: 'Downloads in progress among the selection will be stopped. Progress is lost.',
        confirmLabel: 'Remove',
        danger: true,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.runBulk(ids, 'delete', 'remove');
      });
  }

  // ---- Formatting ----

  percent(job: { total_bytes: number; downloaded_bytes: number }): number {
    const total = this.normalizeNonNegative(job.total_bytes);
    if (total <= 0) return 0;
    const downloaded = this.normalizeNonNegative(job.downloaded_bytes);
    return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  }

  eta(job: NzbJob): string {
    const speed = this.normalizeNonNegative(job.speed_bps);
    if (speed <= 0) return '—';
    const secs = this.remainingForJob(job) / speed;
    if (!Number.isFinite(secs) || secs <= 0) return '—';
    return this.formatDuration(secs);
  }

  formatDuration(secs: number): string {
    if (!Number.isFinite(secs) || secs <= 0) return '0s';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  failedArticlesLabel(count: number): string {
    const failed = Math.max(0, Math.floor(this.normalizeNonNegative(count)));
    return `${failed} failed article${failed === 1 ? '' : 's'}`;
  }

  private remainingForJob(job: { total_bytes: number; downloaded_bytes: number }): number {
    return Math.max(
      0,
      this.normalizeNonNegative(job.total_bytes) - this.normalizeNonNegative(job.downloaded_bytes),
    );
  }

  private normalizeNonNegative(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  priorityLabel(p: number): string {
    return ['Low', 'Normal', 'High', 'Force'][p] || 'Normal';
  }

  statusClass(status: string): string {
    if (status === 'downloading') return 's-dl';
    if (status === 'queued') return 's-q';
    if (status === 'paused') return 's-paused';
    if (status === 'completed') return 's-ok';
    if (status === 'failed') return 's-fail';
    if (this.isPostProc(status)) return 's-pp';
    return 's-q';
  }

  /** Whether this job is paused by the disk-space guard. */
  isDiskSpaceHold(job: NzbJob): boolean {
    if (this.effectiveStatus(job.status) !== 'paused') return false;
    const reason = job.pause_reason ?? (this.paused() ? this.pauseReason() : null);
    return reason === 'disk_space';
  }

  statusLabel(job: NzbJob): string {
    if (this.isDiskSpaceHold(job)) return 'paused · low disk';
    return this.displayStatus(this.rowStatus(job));
  }

  /** Status as shown: the global pause stops downloading and queued jobs. */
  effectiveStatus(status: string): string {
    if (this.paused() && (status === 'downloading' || status === 'queued')) return 'paused';
    return status;
  }

  /** Row status: a fully downloaded job awaiting hand-off already reads as completed. */
  rowStatus(job: NzbJob): string {
    const total = this.normalizeNonNegative(job.total_bytes);
    if (
      total > 0 &&
      this.remainingForJob(job) === 0 &&
      (job.status === 'downloading' || job.status === 'queued')
    ) {
      return 'completed';
    }
    return this.effectiveStatus(job.status);
  }

  shouldShowLiveMetrics(job: NzbJob): boolean {
    const status = this.rowStatus(job);
    return status === 'downloading' || this.isPostProc(status);
  }

  displayStatus(status: string): string {
    if (status === 'verifying') return 'par2 verify';
    if (status === 'repairing') return 'par2 repair';
    if (status === 'extracting') return 'unrar';
    return status;
  }

  formatSpeed(bps: number): string {
    return formatSpeed(bps);
  }

  formatBytes(bytes: number): string {
    return formatBytes(bytes);
  }
}
