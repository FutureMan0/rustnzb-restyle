import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ApiService } from '../../core/services/api.service';
import { formatBytes } from '../../core/format';

interface StatisticsPeriod {
  downloads: number;
  completed: number;
  failed: number;
  bytes_downloaded: number;
  total_duration_secs: number;
  average_speed_bps: number;
  fastest_download_bps: number;
  news_server_hits: number;
  articles_served: number;
  articles_missing: number;
}

interface ServerStatistics {
  server_id: string;
  server_name: string;
  total_bytes: number;
  today_bytes: number;
  week_bytes: number;
  month_bytes: number;
  total_ok: number;
  today_ok: number;
  week_ok: number;
  month_ok: number;
  total_fail: number;
  today_fail: number;
  week_fail: number;
  month_fail: number;
  last_active: string | null;
}

interface DailyStatistics extends StatisticsPeriod { date: string; }

interface GlobalStatistics {
  generated_at: string;
  lifetime: StatisticsPeriod;
  today: StatisticsPeriod;
  week: StatisticsPeriod;
  month: StatisticsPeriod;
  servers: ServerStatistics[];
  daily: DailyStatistics[];
}

type Period = 'today' | 'week' | 'month' | 'lifetime';

@Component({
  selector: 'app-statistics-view',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="section-head">
      <div>
        <h2>Statistics</h2>
        <div class="sub">Persistent download, speed, news server, and article availability totals.</div>
      </div>
      <div class="periods" role="group" aria-label="Statistics period">
        @for (period of periodOptions; track period.id) {
          <button
            type="button"
            class="period-chip"
            [class.active]="selectedPeriod() === period.id"
            [attr.aria-pressed]="selectedPeriod() === period.id"
            (click)="selectedPeriod.set(period.id)">
            {{ period.label }}
          </button>
        }
      </div>
    </div>

    @if (loading()) {
      <div class="inset-section"><div class="inset-section__body"><div class="empty-state"><p>Loading statistics…</p></div></div></div>
    } @else if (statistics()) {
      @let totals = selectedTotals();
      <div class="cards4">
        <div class="card premium-stat">
          <div class="label">Downloads</div>
          <div class="val val-premium tabular-nums">{{ formatCount(totals.downloads) }}</div>
          <div class="sub bullet">
            <span class="ok-text">{{ formatCount(totals.completed) }} completed</span>
            <span class="sep">•</span>
            <span [class.fail-text]="totals.failed > 0">{{ formatCount(totals.failed) }} failed</span>
          </div>
        </div>
        <div class="card premium-stat">
          <div class="label">Downloaded</div>
          <div class="val val-premium tabular-nums">{{ formatBytes(totals.bytes_downloaded) }}</div>
          <div class="sub">{{ periodLabel() }}</div>
        </div>
        <div class="card premium-stat">
          <div class="label">Average speed</div>
          <div class="val val-premium tabular-nums">{{ formatSpeed(totals.average_speed_bps) }}</div>
          <div class="sub">Fastest {{ formatSpeed(totals.fastest_download_bps) }}</div>
        </div>
        <div class="card premium-stat">
          <div class="label">Article availability</div>
          <div class="val val-premium tabular-nums">{{ availability(totals) }}</div>
          <div class="bar green"><div [style.width.%]="availabilityPct(totals.articles_served, totals.articles_missing)"></div></div>
          <div class="sub">{{ formatCount(totals.articles_served) }} served · {{ formatCount(totals.articles_missing) }} missing</div>
        </div>
      </div>

      <div class="cards3">
        <div class="card">
          <div class="label">News server hits</div>
          <div class="val">{{ formatCount(totals.news_server_hits) }}</div>
          <div class="sub">Every served or missing article response</div>
        </div>
        <div class="card">
          <div class="label">Articles served</div>
          <div class="val">{{ formatCount(totals.articles_served) }}</div>
          <div class="sub">Successful article responses</div>
        </div>
        <div class="card">
          <div class="label">Articles missing</div>
          <div class="val" [class.fail-text]="totals.articles_missing > 0">{{ formatCount(totals.articles_missing) }}</div>
          <div class="sub">Unavailable article responses</div>
        </div>
      </div>

      <!-- ============ News servers ============ -->
      <div class="inset-section">
        <div class="inset-section__header">News servers · {{ periodLabel() }}</div>
        <div class="list-mobile-only">
          @for (server of statistics()!.servers; track server.server_id) {
            <div class="group-box">
              <span class="group-box__caption">
                {{ server.last_active ? 'Active ' + relativeTime(server.last_active) : 'Never active' }}
              </span>
              <div class="group-box__title">{{ server.server_name || server.server_id }}</div>
              <div class="stat-grid">
                <div><span class="k">Downloaded</span><span class="v">{{ formatBytes(serverBytes(server)) }}</span></div>
                <div><span class="k">Availability</span><span class="v">{{ availabilityCounts(serverServed(server), serverMissing(server)) }}</span></div>
                <div><span class="k">Served</span><span class="v">{{ formatCount(serverServed(server)) }}</span></div>
                <div><span class="k">Missing</span><span class="v" [class.fail-text]="serverMissing(server) > 0">{{ formatCount(serverMissing(server)) }}</span></div>
              </div>
              <div class="bar green"><div [style.width.%]="availabilityPct(serverServed(server), serverMissing(server))"></div></div>
            </div>
          } @empty {
            <div class="inset-section__body">
              <div class="empty-state empty-state--tint">
                <div class="empty-state__icon" aria-hidden="true">🛰</div>
                <h3>No activity</h3>
                <p>No news server activity recorded yet.</p>
              </div>
            </div>
          }
        </div>
        <div class="panel tbl-desktop-only">
          <div class="body flush">
            <table class="data">
              <thead><tr><th>Server</th><th>Downloaded</th><th>Hits</th><th>Served</th><th>Missing</th><th>Availability</th><th>Last active</th></tr></thead>
              <tbody>
                @for (server of statistics()!.servers; track server.server_id) {
                  <tr>
                    <td class="strong">{{ server.server_name || server.server_id }}</td>
                    <td class="num">{{ formatBytes(serverBytes(server)) }}</td>
                    <td class="num">{{ formatCount(serverServed(server) + serverMissing(server)) }}</td>
                    <td class="num">{{ formatCount(serverServed(server)) }}</td>
                    <td class="num" [class.fail-text]="serverMissing(server) > 0">{{ formatCount(serverMissing(server)) }}</td>
                    <td class="num">{{ availabilityCounts(serverServed(server), serverMissing(server)) }}</td>
                    <td class="dim">{{ server.last_active ? relativeTime(server.last_active) : '—' }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="empty">No news server activity recorded yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ============ Last 30 days ============ -->
      <div class="inset-section">
        <div class="inset-section__header">Last 30 days · daily finalized downloads</div>
        <div class="list-mobile-only">
          @if (statistics()!.daily.length === 0) {
            <div class="inset-section__body">
              <div class="empty-state empty-state--tint">
                <div class="empty-state__icon" aria-hidden="true">📊</div>
                <h3>No downloads</h3>
                <p>No finalized downloads in the last 30 days.</p>
              </div>
            </div>
          } @else {
            <div class="inset-section__body">
              @for (day of statistics()!.daily; track day.date) {
                <div class="day-row">
                  <div class="day-main">
                    <span class="day-date">{{ day.date }}</span>
                    <span class="day-bytes tabular-nums">{{ formatBytes(day.bytes_downloaded) }}</span>
                  </div>
                  <div class="day-bar"><div [style.width.%]="dayBarPct(day.bytes_downloaded)"></div></div>
                  <div class="bullet-row">
                    <span class="tabular-nums">{{ day.downloads }} {{ day.downloads === 1 ? 'download' : 'downloads' }}</span>
                    <span class="sep">•</span>
                    <span class="tabular-nums">{{ formatSpeed(day.average_speed_bps) }}</span>
                    <span class="sep">•</span>
                    <span class="tabular-nums">{{ availability(day) }} available</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>
        <div class="panel tbl-desktop-only">
          <div class="body flush">
            <table class="data">
              <thead><tr><th>Date</th><th>Downloads</th><th>Downloaded</th><th style="width:22%"></th><th>Average speed</th><th>Server hits</th><th>Availability</th></tr></thead>
              <tbody>
                @for (day of statistics()!.daily; track day.date) {
                  <tr>
                    <td class="strong">{{ day.date }}</td>
                    <td class="num">{{ day.downloads }}</td>
                    <td class="num">{{ formatBytes(day.bytes_downloaded) }}</td>
                    <td><div class="day-bar"><div [style.width.%]="dayBarPct(day.bytes_downloaded)"></div></div></td>
                    <td class="num">{{ formatSpeed(day.average_speed_bps) }}</td>
                    <td class="num">{{ formatCount(day.news_server_hits) }}</td>
                    <td class="num">{{ availability(day) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="empty">No finalized downloads in the last 30 days.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    } @else {
      <div class="inset-section">
        <div class="inset-section__body">
          <div class="empty-state">
            <div class="empty-state__icon" aria-hidden="true">⚠️</div>
            <h3>Unavailable</h3>
            <p>Statistics could not be loaded.</p>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    .periods {
      display: flex; gap: 4px; padding: 3px;
      background: var(--panel2); border-radius: var(--radius-pill);
      max-width: 100%; overflow-x: auto; scrollbar-width: none;
    }
    .periods::-webkit-scrollbar { display: none; }
    .period-chip {
      flex: 1 0 auto;
      border: none; background: transparent; color: var(--text-secondary);
      font: var(--font-footnote); font-weight: 600;
      padding: 7px 14px; min-height: 36px; border-radius: var(--radius-pill);
      cursor: pointer; white-space: nowrap;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .period-chip:hover:not(.active) { color: var(--text); }
    .period-chip.active {
      background: var(--tint); color: #fff;
      box-shadow: 0 1px 3px color-mix(in srgb, var(--tint) 35%, transparent);
    }
    .period-chip:focus-visible { outline: 2px solid var(--tint); outline-offset: 2px; }

    .ok-text { color: var(--ok-text); }
    .fail-text { color: var(--fail-text, var(--danger)); }

    .inset-section .panel { margin-bottom: 0; }
    .inset-section__header { padding-left: 4px; padding-right: 4px; }

    .stat-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px;
      margin-top: 4px;
    }
    .stat-grid > div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .stat-grid .k {
      font: var(--font-caption); color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500;
    }
    .stat-grid .v { font: var(--font-headline); font-variant-numeric: tabular-nums; }

    .day-row { padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .day-row:last-child { border-bottom: none; }
    .day-main { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .day-date { font: var(--font-headline); }
    .day-bytes { font: var(--font-headline); color: var(--tint); }
    .day-row .day-bar { margin: 8px 0 6px; }

    .day-bar {
      height: 6px; border-radius: 3px; overflow: hidden;
      background: var(--panel2);
    }
    .day-bar > div {
      height: 100%; background: var(--tint); border-radius: 3px;
      transition: width 0.3s;
    }

    td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
    td.strong { font-weight: 600; }
    td.dim { color: var(--mute); }
    .empty { padding: 28px !important; text-align: center; color: var(--mute); }

    @media (max-width: 767px) {
      .section-head { flex-direction: column; align-items: stretch; }
      .periods { width: 100%; box-sizing: border-box; }
    }
    /* The shell already shows the large page title below the desktop breakpoint. */
    @media (max-width: 1023px) {
      .section-head h2 { display: none; }
    }
  `],
})
export class StatisticsViewComponent implements OnInit {
  readonly periodOptions: readonly { id: Period; label: string }[] = [
    { id: 'today', label: '24 hours' },
    { id: 'week', label: '7 days' },
    { id: 'month', label: '30 days' },
    { id: 'lifetime', label: 'Lifetime' },
  ];
  readonly selectedPeriod = signal<Period>('month');
  readonly statistics = signal<GlobalStatistics | null>(null);
  readonly loading = signal(true);
  readonly selectedTotals = computed(() => {
    const statistics = this.statistics();
    return statistics?.[this.selectedPeriod()] ?? this.emptyPeriod();
  });

  /** Human label for the selected period (card and section captions). */
  readonly periodLabel = computed(
    () => this.periodOptions.find(p => p.id === this.selectedPeriod())?.label ?? '',
  );
  /** Largest daily volume; scales the per-day bars. */
  private readonly maxDailyBytes = computed(() =>
    Math.max(0, ...(this.statistics()?.daily ?? []).map(d => d.bytes_downloaded || 0)),
  );

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<GlobalStatistics>('/statistics').subscribe({
      next: statistics => { this.statistics.set(statistics); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  serverBytes(server: ServerStatistics): number {
    switch (this.selectedPeriod()) {
      case 'today': return server.today_bytes;
      case 'week': return server.week_bytes;
      case 'month': return server.month_bytes;
      case 'lifetime': return server.total_bytes;
    }
  }
  serverServed(server: ServerStatistics): number {
    switch (this.selectedPeriod()) {
      case 'today': return server.today_ok;
      case 'week': return server.week_ok;
      case 'month': return server.month_ok;
      case 'lifetime': return server.total_ok;
    }
  }
  serverMissing(server: ServerStatistics): number {
    switch (this.selectedPeriod()) {
      case 'today': return server.today_fail;
      case 'week': return server.week_fail;
      case 'month': return server.month_fail;
      case 'lifetime': return server.total_fail;
    }
  }

  availability(period: StatisticsPeriod): string { return this.availabilityCounts(period.articles_served, period.articles_missing); }
  /** Served share in percent (0 when nothing was requested); drives the bars. */
  availabilityPct(served: number, missing: number): number {
    const total = served + missing;
    return total > 0 ? (served / total) * 100 : 0;
  }
  dayBarPct(bytes: number): number {
    const max = this.maxDailyBytes();
    return max > 0 && bytes > 0 ? Math.max(2, (bytes / max) * 100) : 0;
  }
  availabilityCounts(served: number, missing: number): string {
    const total = served + missing;
    return total > 0 ? `${((served / total) * 100).toFixed(2)}%` : '—';
  }

  formatBytes(bytes: number): string {
    return formatBytes(bytes);
  }
  formatSpeed(bytes: number): string { return `${formatBytes(bytes)}/s`; }
  formatCount(value: number): string { return new Intl.NumberFormat().format(value || 0); }
  relativeTime(value: string): string {
    const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    return `${Math.floor(seconds / 86400)} d ago`;
  }

  private emptyPeriod(): StatisticsPeriod {
    return { downloads: 0, completed: 0, failed: 0, bytes_downloaded: 0, total_duration_secs: 0, average_speed_bps: 0, fastest_download_bps: 0, news_server_hits: 0, articles_served: 0, articles_missing: 0 };
  }
}
