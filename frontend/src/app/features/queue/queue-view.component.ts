import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { finalize, forkJoin, Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NzbJob, QueueResponse, StatusResponse } from '../../core/models/queue.model';
import { QueueJobSheetComponent } from './queue-job-sheet.component';

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
        <div class="sub bullet">
          <span>{{ paused() ? 'Paused' : 'Active' }}</span>
          <span class="sep">·</span>
          <span>limit off</span>
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
          <span>ETA</span>
          <span class="sep">·</span>
          <span class="tabular-nums">{{ etaTotal() }}</span>
        </div>
      </div>
      <div class="card">
        <div class="label">Disk free</div>
        <div class="val val-premium tabular-nums">{{ diskFreeValue() }} <span class="unit">{{ diskFreeUnit() }}</span></div>
        <div class="bar green"><div [style.width.%]="diskUsedPct()"></div></div>
        <div class="sub bullet">
          <span>Downloads volume</span>
        </div>
      </div>
    </div>

    <!-- ============ Per-server connection pool ============ -->
    <div class="panel pool-panel" [class.collapsed]="poolCollapsed()">
      <h3>NNTP connection pool
        <span class="hint">priority failover · TLS via rustls · live</span>
        <button class="collapse-btn" (click)="togglePool()" [title]="poolCollapsed() ? 'Expand' : 'Collapse'">
          {{ poolCollapsed() ? '▸' : '▾' }}
        </button>
      </h3>
      @if (!poolCollapsed()) {
        <div class="body">
          @if (displayServers().length === 0) {
            <div class="empty">No servers configured. <a routerLink="/settings">Add one →</a></div>
          }
          @for (s of serversWithConns(); track s.id) {
            <div class="srv-block">
              <div class="srv-head">
                <div>
                  <span class="srv-name" [class.dim]="!s.enabled">{{ s.name || s.host }}</span>
                  <span class="prio">
                    priority {{ s.priority }} · {{ s.connections }} slots
                    @if (!s.enabled) { · disabled }
                  </span>
                </div>
                <div class="srv-meta">
                  @if (s.enabled) {
                    {{ s.active }} active · {{ s.idle }} idle
                  } @else {
                    off
                  }
                </div>
              </div>
              <div class="conn-grid">
                @for (i of gridRange(s.connections); track i) {
                  <div class="c"
                       [class.active]="s.enabled && i < s.active"
                       [class.idle]="s.enabled && i >= s.active && i < s.active + s.idle"
                       [class.err]="!s.enabled"></div>
                }
              </div>
            </div>
          }
          <div class="legend">
            <span class="sw a">Active transfer</span>
            <span class="sw i">Idle (pooled)</span>
            <span class="sw f">Free slot</span>
            <span class="sw e">Disabled / error</span>
            <span style="margin-left:auto">Transport: NNTPS · rustls (ring)</span>
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
          <span class="hint pp-head-status">{{ pp.status }}</span>
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
      <div class="filter-chips">
        <button type="button" class="chip" [class.active]="filterStatus === 'all'" (click)="filterStatus = 'all'">
          All ({{ displayJobs().length }})
        </button>
        <button type="button" class="chip" [class.active]="filterStatus === 'active'" (click)="filterStatus = 'active'">
          Active ({{ countJobs('active') }})
        </button>
        <button type="button" class="chip" [class.active]="filterStatus === 'queued'" (click)="filterStatus = 'queued'">
          Queued ({{ countJobs('queued') }})
        </button>
        <button type="button" class="chip" [class.active]="filterStatus === 'paused'" (click)="filterStatus = 'paused'">
          Paused ({{ countJobs('paused') }})
        </button>
      </div>
      <div class="filter-btn-wrap">
        <button mat-icon-button type="button" [matMenuTriggerFor]="filterMenu" aria-label="Filter">
          <mat-icon [class.filter-active]="filterStatus !== 'all'">filter_list</mat-icon>
        </button>
        @if (filterStatus !== 'all') {
          <span class="filter-badge-dot" aria-hidden="true"></span>
        }
        <mat-menu #filterMenu="matMenu">
          <button mat-menu-item type="button" (click)="filterStatus = 'all'">All</button>
          <button mat-menu-item type="button" (click)="filterStatus = 'active'">Active</button>
          <button mat-menu-item type="button" (click)="filterStatus = 'queued'">Queued</button>
          <button mat-menu-item type="button" (click)="filterStatus = 'paused'">Paused</button>
        </mat-menu>
      </div>
      @if (selectedIds().size > 0) {
        <div class="bulk-bar">
          <span class="bulk-count">{{ selectedIds().size }} selected</span>
          <button type="button" class="btn sm" (click)="bulkResume()">Start</button>
          <button type="button" class="btn sm" (click)="bulkPause()">Pause</button>
          <button type="button" class="btn sm danger" (click)="bulkDelete()">Delete</button>
          <button type="button" class="btn sm ghost" (click)="clearSelection()">✕</button>
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
      </h3>
      <div class="body flush tbl-wrap">
        @if (filteredJobs().length === 0) {
          <div class="empty-state empty-state--tint empty-state--in-panel">
            <div class="empty-state__icon" aria-hidden="true">⬇</div>
            @if (displayJobs().length === 0) {
              <h3>Queues empty</h3>
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
                  <th style="width: 32px"></th>
                  <th class="col-name">Name</th>
                  <th>Size</th>
                  <th>Progress</th>
                  <th>Speed</th>
                  <th>ETA</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th></th>
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
                          [checked]="selectedIds().has(job.id)"
                          (change)="toggleSelected(job.id)"
                        />
                      </span>
                    </td>
                    <td
                      class="col-name cell-ellipsis cell-name--click"
                      [attr.title]="job.name"
                      (click)="$event.stopPropagation(); openJobSheet(job)"
                    >
                      {{ job.name }}
                    </td>
                    <td class="tabular-nums" (click)="$event.stopPropagation()">
                      {{ formatBytes(job.total_bytes) }}
                    </td>
                    <td (click)="$event.stopPropagation()">
                      <div class="progress" [class.pp]="isPostProc(job.status)">
                        <div [style.width.%]="percent(job)"></div>
                      </div>
                    </td>
                    <td class="tabular-nums col-speed" (click)="$event.stopPropagation()">
                      {{ shouldShowLiveMetrics(job) ? formatSpeed(job.speed_bps) : '—' }}
                    </td>
                    <td class="tabular-nums col-eta" (click)="$event.stopPropagation()">
                      {{ shouldShowLiveMetrics(job) ? eta(job) : '—' }}
                    </td>
                    <td class="col-status" (click)="$event.stopPropagation()">
                      <span class="status-pill" [class]="statusClass(job.status)">{{ displayStatus(job.status) }}</span>
                    </td>
                    <td class="col-priority" (click)="$event.stopPropagation()">
                      <span
                        class="pri-pill"
                        [class.pri-pill--0]="priorityForPosition(job) === 0"
                        [class.pri-pill--1]="priorityForPosition(job) === 1"
                        [class.pri-pill--2]="priorityForPosition(job) === 2"
                        [class.pri-pill--3]="priorityForPosition(job) === 3"
                        [attr.title]="'Priorität: oben in der Liste = höher — Zeile mit ⠿ verschieben'"
                      >
                        {{ priorityLabel(priorityForPosition(job)) }}
                      </span>
                    </td>
                    <td class="actions col-actions" (click)="$event.stopPropagation()">
                      @if (job.status === 'paused') {
                        <button type="button" class="row-action" [disabled]="isDemoJob(job) || isActionPending(job.id)" (click)="resumeJob(job.id)">▶</button>
                      } @else {
                        <button type="button" class="row-action" [disabled]="isDemoJob(job) || isActionPending(job.id)" (click)="pauseJob(job.id)">❚❚</button>
                      }
                      <button type="button" class="row-action danger" [disabled]="isDemoJob(job) || isActionPending(job.id)" (click)="deleteJob(job.id)">✕</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
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
    .q-item__title-line {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      width: 100%;
    }
    .q-item__title-line .q-item__title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .q-item__title-line .tag {
      flex-shrink: 0;
      max-width: 40%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* NOTE: keep table cells as table-cells (no flex on <td>). Drag behavior is on the inner handle. */
    .q-row.cdk-drag-preview {
      box-sizing: border-box;
      display: flex;
      align-items: stretch;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--radius-row);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
      padding-right: 4px;
    }
    .q-row .cdk-drag-placeholder {
      opacity: 0.25;
      min-height: 48px;
      background: var(--panel2);
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
      width: 28%;
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
    :host ::ng-deep .progress { width: 112px; height: 5px; }

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
    .conn-grid .c.idle   { background: var(--accent); }
    .conn-grid .c.err    { background: var(--danger); opacity: .6; }
    .legend { display: flex; gap: 10px; font-size: 10px; color: var(--mute); margin-top: 6px; align-items: center; }
    .legend .sw { display: inline-flex; align-items: center; }
    .legend .sw::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }
    .legend .a::before { background: var(--accent2); }
    .legend .i::before { background: var(--accent); }
    .legend .f::before { background: var(--panel2); border: 1px solid var(--line); }
    .legend .e::before { background: var(--danger); opacity: .6; }
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
    .queue-inset {
      max-width: none;
    }
    .q-row {
      display: flex;
      align-items: stretch;
      border-bottom: 1px solid var(--line);
    }
    .q-row:last-child {
      border-bottom: none;
    }
    .q-row .q-cb {
      align-self: center;
      width: 20px;
      margin: 0 4px 0 8px;
      flex-shrink: 0;
    }
    .q-row .q-item {
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: none;
      flex: 1;
      min-width: 0;
    }
    .q-item__dot {
      flex-shrink: 0;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--text-secondary);
      box-shadow: 0 0 0 1px var(--line);
    }
    .q-item__dot.q-dot--dl { background: var(--tint); }
    .q-item__dot.q-dot--q { background: var(--warn); }
    .q-item__dot.q-dot--paused { background: #eab308; }
    .q-item__dot.q-dot--pp { background: var(--accent2); }
    .q-item__dot.q-dot--fail { background: var(--danger); }
    .q-item__dot.q-dot--pulse { animation: pulse-live 1.2s var(--ease-out-soft) infinite; }
    .q-vbar {
      width: 4px;
      height: 44px;
      align-self: center;
      flex-shrink: 0;
      background: var(--panel2);
      border-radius: 2px;
      position: relative;
      overflow: hidden;
    }
    .q-vbar__fill {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--tint);
      min-height: 0;
      transition: height 0.25s var(--ease-out-soft);
    }
    .q-vbar.pp .q-vbar__fill { background: var(--purple); }
    .q-row__quick {
      display: none;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
      padding-right: 4px;
      flex-shrink: 0;
    }
    @media (min-width: 1024px) {
      .q-row:hover .q-row__quick { display: flex; }
    }
    .q-mini {
      width: 30px;
      min-height: 30px;
      padding: 0;
      font-size: 12px;
      line-height: 1;
      border: none;
      background: var(--panel2);
      color: var(--tint);
      border-radius: 6px;
      cursor: pointer;
    }
    .q-mini:disabled { opacity: 0.3; cursor: not-allowed; }
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
      :host ::ng-deep .progress { width: 92px; }
      :host ::ng-deep .status-pill { max-width: 90px; }
    }
  `],
})
export class QueueViewComponent implements OnInit, OnDestroy {
  jobs = signal<NzbJob[]>([]);
  remainingBytes = signal(0);
  servers = signal<ServerConfigLite[]>([]);
  status = signal<StatusResponse | null>(null);
  selectedIds = signal<Set<string>>(new Set());
  paused = signal(false);
  /** When the real queue is empty, show filled sample rows (can be turned off in localStorage). */
  readonly showQueueDummy = signal(this.readQueueDummyPref());
  /** Last ~30 global speed samples for the sparkline (from /queue). */
  speedHistory = signal<number[]>([]);
  speedFlash = signal(false);
  actionPendingIds = signal<Set<string>>(new Set());
  private lastQueueSpeedBps = 0;

  /** When showing the sample queue, id order after drag (preview only); `null` = default. */
  private readonly demoIdOrder = signal<string[] | null>(null);

  /** Jobs shown in the list: real from API, or sample data when the queue is empty. */
  readonly displayJobs = computed((): NzbJob[] => {
    if (this.jobs().length > 0) return this.jobs();
    if (this.showQueueDummy()) {
      const custom = this.demoIdOrder();
      if (custom && custom.length > 0) {
        const byId = new Map(DEMO_QUEUE_JOBS.map((j): [string, NzbJob] => [j.id, j]));
        return custom.map(id => byId.get(id)).filter((j): j is NzbJob => j != null);
      }
      return [...DEMO_QUEUE_JOBS];
    }
    return [];
  });

  /** Servers: real, or a single placeholder row in preview mode when there are no servers. */
  readonly displayServers = computed((): ServerConfigLite[] => {
    const s = this.servers();
    if (s.length > 0) return s;
    if (this.jobs().length === 0 && this.showQueueDummy()) return [DEMO_SRV];
    return s;
  });

  readonly inDummyMode = computed(() => this.jobs().length === 0 && this.showQueueDummy());

  readonly displayRemainingBytes = computed(() => {
    if (this.jobs().length > 0) return this.normalizeNonNegative(this.remainingBytes());
    if (this.showQueueDummy()) {
      return DEMO_QUEUE_JOBS.reduce((sum, j) => sum + this.remainingForJob(j), 0);
    }
    return 0;
  });

  readonly displaySpeedBps = computed(() => {
    if (this.jobs().length === 0 && this.showQueueDummy()) {
      return Math.round(12.4 * 1024 * 1024);
    }
    return this.normalizeNonNegative(this.status()?.speed_bps);
  });

  readonly displayDiskFreeBytes = computed(() => {
    if (this.jobs().length === 0 && this.showQueueDummy()) {
      return 450 * 1024 * 1024 * 1024;
    }
    return this.normalizeNonNegative(this.status()?.disk_free_bytes);
  });

  readonly sparklinePath = computed(() => {
    if (this.jobs().length === 0 && this.showQueueDummy()) {
      return this.sparklineDummyPath();
    }
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

  readonly POOL_KEY = 'rustnzb.poolPanelCollapsed';
  poolCollapsed = signal(localStorage.getItem('rustnzb.poolPanelCollapsed') === 'true');

  togglePool(): void {
    const next = !this.poolCollapsed();
    this.poolCollapsed.set(next);
    localStorage.setItem(this.POOL_KEY, String(next));
  }

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Filter
  filterStatus: 'all' | 'active' | 'queued' | 'paused' = 'all';

  private bottomSheet = inject(MatBottomSheet);

  constructor(
    private api: ApiService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadAll();
    this.pollTimer = setInterval(() => this.loadQueue(), 2000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  openJobSheet(job: NzbJob): void {
    if (this.isDemoJob(job)) {
      this.snackBar.open('Sample row only — add a real NZB to open job details.', 'OK', { duration: 4000 });
      return;
    }
    const idx = this.jobs().findIndex(j => j.id === job.id);
    const ref = this.bottomSheet.open(QueueJobSheetComponent, {
      data: { job, index: idx >= 0 ? idx : 0, total: this.jobs().length },
      panelClass: 'ruddarr-bottom-sheet',
    });
    ref.afterDismissed().subscribe(r => {
      if (r === 'refresh') this.loadQueue();
    });
  }

  dismissDummyPreview(): void {
    localStorage.setItem('rustnzb.queueShowDummy', 'false');
    this.showQueueDummy.set(false);
    this.demoIdOrder.set(null);
  }

  isDemoJob(job: NzbJob): boolean {
    return job.id.startsWith(DEMO_JOB_PREFIX);
  }

  isActionPending(id: string): boolean {
    return this.actionPendingIds().has(id);
  }

  private readQueueDummyPref(): boolean {
    return localStorage.getItem('rustnzb.queueShowDummy') !== 'false';
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

  onRowContext(ev: MouseEvent, job: NzbJob): void {
    ev.preventDefault();
    this.openJobSheet(job);
  }

  /** Drag-and-drop enabled: filter «All» and at least one row (real or sample). */
  canDragInTable(): boolean {
    return this.filterStatus === 'all' && this.displayJobs().length > 0;
  }

  onQueueDrop(event: CdkDragDrop<NzbJob>): void {
    if (this.filterStatus !== 'all') return;
    const p = event.previousIndex;
    const c = event.currentIndex;
    if (p === c) return;
    if (this.inDummyMode()) {
      const list = [...this.displayJobs()];
      if (p < 0 || p >= list.length) return;
      moveItemInArray(list, p, c);
      this.demoIdOrder.set(list.map(j => j.id));
      return;
    }
    const list = this.jobs();
    if (p < 0 || p >= list.length) return;
    const job = (event.item.data as NzbJob) ?? list[p];
    if (this.isDemoJob(job) || !list.some(j => j.id === job.id)) return;
    this.api.post(`/queue/${job.id}/move`, { position: c }).subscribe({
      next: () => {
        this.api.get<QueueResponse>('/queue').subscribe({
          next: (r) => {
            this.applyQueueResponse(r);
            this.applyPositionPrioritiesThenReload(r.jobs);
          },
          error: () => {
            this.snackBar.open('Move ok, but queue could not be reloaded.', 'OK', { duration: 3000 });
            this.loadQueue();
          },
        });
      },
      error: () => {
        this.snackBar.open('Could not move job.', 'OK', { duration: 3000 });
      },
    });
  }

  countJobs(kind: 'active' | 'queued' | 'paused'): number {
    const all = this.displayJobs();
    if (kind === 'active') return all.filter(j => j.status === 'downloading' || this.isPostProc(j.status)).length;
    if (kind === 'queued') return all.filter(j => j.status === 'queued').length;
    return all.filter(j => j.status === 'paused').length;
  }

  private loadAll(): void {
    this.loadQueue();
    this.loadServers();
  }

  /** 0 = top: Force (3) … 4+ = Low (0). */
  private priorityValueForIndex(index: number): number {
    return Math.max(0, Math.min(3, 3 - index));
  }

  /** Priority 0..3 from position in the full queue (top = highest). */
  priorityForPosition(job: NzbJob): number {
    const list = this.jobs().length > 0 ? this.jobs() : this.displayJobs();
    const i = list.findIndex(j => j.id === job.id);
    return this.priorityValueForIndex(i >= 0 ? i : 0);
  }

  priorityLabel(n: number): string {
    const m: Record<number, string> = { 0: 'Low', 1: 'Normal', 2: 'High', 3: 'Force' };
    return m[n] ?? '—';
  }

  private applyPositionPrioritiesThenReload(jobs: NzbJob[]): void {
    if (this.inDummyMode() || jobs.length === 0) {
      this.loadQueue();
      return;
    }
    const puts: Observable<unknown>[] = [];
    for (let i = 0; i < jobs.length; i++) {
      const want = this.priorityValueForIndex(i);
      if (jobs[i].priority !== want) {
        puts.push(this.api.put(`/queue/${jobs[i].id}/priority`, { priority: want }));
      }
    }
    if (puts.length === 0) {
      this.loadQueue();
      return;
    }
    forkJoin(puts).subscribe({
      next: () => this.loadQueue(),
      error: () => {
        this.snackBar.open('Order updated; priority not adjusted for all jobs.', 'OK', { duration: 4000 });
        this.loadQueue();
      },
    });
  }

  private applyQueueResponse(r: QueueResponse): void {
    this.jobs.set(r.jobs);
    this.paused.set(r.paused);
    if (r.jobs.length > 0) {
      this.demoIdOrder.set(null);
    }
    this.remainingBytes.set(r.jobs.reduce((sum, j) => sum + this.remainingForJob(j), 0));
    const sp = this.normalizeNonNegative(r.speed_bps);
    this.speedHistory.set([...this.speedHistory(), sp].slice(-30));
    if (sp !== this.lastQueueSpeedBps) {
      this.lastQueueSpeedBps = sp;
      this.speedFlash.set(true);
      setTimeout(() => this.speedFlash.set(false), 120);
    }
    const liveIds = new Set(r.jobs.map(j => j.id));
    const cur = this.selectedIds();
    const next = new Set<string>();
    for (const id of cur) if (liveIds.has(id)) next.add(id);
    if (next.size !== cur.size) this.selectedIds.set(next);
  }

  loadQueue(): void {
    this.api.get<QueueResponse>('/queue').subscribe({
      next: (r) => this.applyQueueResponse(r),
      error: () => {},
    });
    this.api.get<StatusResponse>('/status').subscribe({
      next: s => this.status.set(s),
      error: () => {},
    });
  }

  loadServers(): void {
    this.api.get<ServerConfigLite[]>('/config/servers').subscribe({
      next: srvs => this.servers.set(srvs),
      error: () => {},
    });
  }

  // ---- Stat-card derivations ----

  speedValue = computed(() => this.formatSpeedValue(this.displaySpeedBps()));
  speedUnit = computed(() => this.formatSpeedUnit(this.displaySpeedBps()));
  diskFreeValue = computed(() => this.formatBytesValue(this.displayDiskFreeBytes()));
  diskFreeUnit = computed(() => this.formatBytesUnit(this.displayDiskFreeBytes()));
  diskUsedPct = computed(() => 28); // No total-disk endpoint; placeholder bar.

  serversEnabled = computed(() => this.displayServers().filter(s => s.enabled).length);
  connsTotal = computed(() => this.displayServers().filter(s => s.enabled).reduce((n, s) => n + s.connections, 0));
  /**
   * Active connection count across the pool. We don't have a live "in-use"
   * endpoint, so derive a reasonable estimate: every job in `downloading`
   * state burns roughly its allocated slice. Pool sizes still cap the bar.
   */
  connsActive = computed(() => {
    const active = this.displayJobs().filter(j => j.status === 'downloading').length;
    const total = this.connsTotal();
    if (active === 0 || total === 0) return 0;
    // Simple: assume each active job saturates ~half the primary server's conns.
    const primary = this.displayServers().find(s => s.enabled && s.priority === 0);
    const primaryConns = primary?.connections ?? total;
    return Math.min(total, Math.round(primaryConns * active));
  });
  connPct = computed(() => {
    const t = this.connsTotal();
    return t === 0 ? 0 : Math.round((this.connsActive() / t) * 100);
  });

  /**
   * Projected servers with `active`/`idle` fields for the visualiser.
   * The daemon doesn't expose per-server pool state yet, so we distribute
   * `connsActive()` across enabled servers in priority order.
   */
  serversWithConns = computed(() => {
    const enabled = this.displayServers().filter(s => s.enabled).sort((a, b) => a.priority - b.priority);
    const disabled = this.displayServers().filter(s => !s.enabled);
    let remainingActive = this.connsActive();
    const out = enabled.map(s => {
      const active = Math.min(s.connections, remainingActive);
      remainingActive -= active;
      const idle = Math.min(s.connections - active, this.displayJobs().length > 0 ? 1 : 0);
      return { ...s, active, idle };
    });
    return [...out, ...disabled.map(s => ({ ...s, active: 0, idle: 0 }))];
  });

  gridRange(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }

  etaTotal(): string {
    const speed = this.normalizeNonNegative(this.status()?.speed_bps);
    const remaining = this.normalizeNonNegative(this.displayRemainingBytes());
    if (speed <= 0 || remaining <= 0) return '—';
    const secs = remaining / speed;
    if (!Number.isFinite(secs) || secs <= 0) return '—';
    return 'ETA ' + this.formatDuration(secs);
  }

  // ---- Post-processing pipeline ----

  ppJob = computed<NzbJob | null>(() => {
    return this.displayJobs().find(j => this.isPostProc(j.status)) ?? null;
  });

  ppSteps = computed<PipelineStep[]>(() => {
    const job = this.ppJob();
    if (!job) return [];
    const order = ['download', 'decode', 'assemble', 'verify', 'repair', 'extract', 'cleanup'];
    const labels: Record<string, string> = {
      download: 'Download', decode: 'Decode', assemble: 'Assemble',
      verify: 'Par2 verify', repair: 'Par2 repair', extract: 'Unrar', cleanup: 'Cleanup',
    };
    const statusToIdx: Record<string, number> = {
      downloading: 0, verifying: 3, repairing: 4, extracting: 5, completed: 6,
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

  filteredJobs(): NzbJob[] {
    const all = this.displayJobs();
    if (this.filterStatus === 'all') return all;
    if (this.filterStatus === 'active') return all.filter(j => j.status === 'downloading' || this.isPostProc(j.status));
    if (this.filterStatus === 'queued') return all.filter(j => j.status === 'queued');
    if (this.filterStatus === 'paused') return all.filter(j => j.status === 'paused');
    return all;
  }

  // ---- Per-job actions ----

  private withPendingJobAction(id: string, action: Observable<unknown>, successMessage?: string): void {
    if (this.isActionPending(id)) return;
    const pending = new Set(this.actionPendingIds());
    pending.add(id);
    this.actionPendingIds.set(pending);
    action.pipe(
      finalize(() => {
        const next = new Set(this.actionPendingIds());
        next.delete(id);
        this.actionPendingIds.set(next);
      }),
    ).subscribe({
      next: () => {
        if (successMessage) {
          this.snackBar.open(successMessage, 'OK', { duration: 1500 });
        }
        this.loadQueue();
      },
      error: () => {
        this.snackBar.open('Action failed. Please try again.', 'OK', { duration: 3000 });
        this.loadQueue();
      },
    });
  }

  pauseJob(id: string): void {
    if (id.startsWith(DEMO_JOB_PREFIX)) return;
    this.withPendingJobAction(id, this.api.post(`/queue/${id}/pause`), 'Job paused');
  }
  resumeJob(id: string): void {
    if (id.startsWith(DEMO_JOB_PREFIX)) return;
    this.withPendingJobAction(id, this.api.post(`/queue/${id}/resume`), 'Job resumed');
  }

  deleteJob(id: string): void {
    if (id.startsWith(DEMO_JOB_PREFIX)) return;
    this.withPendingJobAction(id, this.api.delete(`/queue/${id}`));
  }

  // ---- Bulk ----

  toggleSelected(id: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selectedIds.set(next);
  }
  clearSelection(): void { this.selectedIds.set(new Set()); }
  allFilteredSelected(): boolean {
    const f = this.filteredJobs();
    if (f.length === 0) return false;
    const sel = this.selectedIds();
    return f.every(j => sel.has(j.id));
  }
  toggleSelectAll(ev: Event): void {
    if ((ev.target as HTMLInputElement).checked) {
      this.selectedIds.set(new Set(this.filteredJobs().map(j => j.id)));
    } else {
      this.clearSelection();
    }
  }
  bulkResume(): void {
    Array.from(this.selectedIds())
      .filter(id => !id.startsWith(DEMO_JOB_PREFIX))
      .forEach(id => this.api.post(`/queue/${id}/resume`).subscribe());
    this.clearSelection();
    setTimeout(() => this.loadQueue(), 300);
  }
  bulkPause(): void {
    Array.from(this.selectedIds())
      .filter(id => !id.startsWith(DEMO_JOB_PREFIX))
      .forEach(id => this.api.post(`/queue/${id}/pause`).subscribe());
    this.clearSelection();
    setTimeout(() => this.loadQueue(), 300);
  }
  bulkDelete(): void {
    const ids = Array.from(this.selectedIds()).filter(id => !id.startsWith(DEMO_JOB_PREFIX));
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} job(s)?`)) return;
    ids.forEach(id => this.api.delete(`/queue/${id}`).subscribe());
    this.clearSelection();
    setTimeout(() => this.loadQueue(), 300);
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

  statusClass(status: string): string {
    if (status === 'downloading') return 's-dl';
    if (status === 'queued') return 's-q';
    if (status === 'paused') return 's-paused';
    if (status === 'completed') return 's-ok';
    if (status === 'failed') return 's-fail';
    if (this.isPostProc(status)) return 's-pp';
    return 's-q';
  }

  displayStatus(status: string): string {
    if (status === 'verifying') return 'par2 verify';
    if (status === 'repairing') return 'par2 repair';
    if (status === 'extracting') return 'unrar';
    return status;
  }

  shouldShowLiveMetrics(job: NzbJob): boolean {
    return job.status === 'downloading' || this.isPostProc(job.status);
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

  formatSpeed(bps: number): string {
    return `${this.formatSpeedValue(bps)} ${this.formatSpeedUnit(bps)}`;
  }
  private formatSpeedValue(bps: number): string {
    const safe = this.normalizeNonNegative(bps);
    if (safe === 0) return '0';
    const k = 1024;
    const i = Math.min(3, Math.floor(Math.log(safe) / Math.log(k)));
    return (safe / Math.pow(k, i)).toFixed(1);
  }
  private formatSpeedUnit(bps: number): string {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const safe = this.normalizeNonNegative(bps);
    if (safe === 0) return 'B/s';
    return units[Math.min(3, Math.floor(Math.log(safe) / Math.log(1024)))];
  }

  formatBytes(bytes: number): string {
    return `${this.formatBytesValue(bytes)} ${this.formatBytesUnit(bytes)}`;
  }
  private formatBytesValue(bytes: number): string {
    const safe = this.normalizeNonNegative(bytes);
    if (safe === 0) return '0';
    const k = 1024;
    const i = Math.min(4, Math.floor(Math.log(safe) / Math.log(k)));
    return (safe / Math.pow(k, i)).toFixed(1);
  }
  private formatBytesUnit(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const safe = this.normalizeNonNegative(bytes);
    if (safe === 0) return 'B';
    return units[Math.min(4, Math.floor(Math.log(safe) / Math.log(1024)))];
  }
}
