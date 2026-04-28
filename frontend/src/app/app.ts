import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from './core/services/api.service';
import { AuthService } from './core/services/auth.service';
import { StatusResponse } from './core/models/queue.model';
import { AddNzbService } from './core/services/add-nzb.service';
import { WidthModeService } from './core/services/width-mode.service';
import { ThemeService } from './core/services/theme.service';
import { AddNzbSheetComponent } from './features/queue/add-nzb-sheet.component';
import { MoreMenuSheetComponent } from './shell/more-menu-sheet.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatBottomSheetModule,
    MatMenuModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    @if (!authenticated()) {
      <router-outlet />
    } @else {
      <div class="shell">
        <header class="app-topbar">
          <div class="topbar-wrap">
            <a routerLink="/queue" class="brand">rust<span>nzb</span></a>
            <span class="ver app-topbar--mobile-only">v{{ version }}</span>
            <div class="spacer"></div>
            <div class="status hide-mobile">
              <span class="app-topbar--live pill" [class.warn]="paused()">
                <span class="live-dot" [class.pulse]="!paused() && speed() > 0" aria-hidden="true"></span>
                <span>Live</span>
                <span class="sep" aria-hidden="true">·</span>
                <span class="tabular-nums">{{ formatSpeed(speed()) }}</span>
                <span class="sep" aria-hidden="true">·</span>
                <span class="tabular-nums">{{ queueCount() }} queued</span>
                @if (paused()) {
                  <span class="sep" aria-hidden="true">·</span>
                  <span>Paused</span>
                }
              </span>
              <span class="pill tabular-nums">{{ formatBytes(diskFree()) }} free</span>
            </div>
            <button
              mat-icon-button
              type="button"
              class="app-topbar--mobile-only"
              (click)="openAddNzb()"
              aria-label="Add NZB"
            >
              <mat-icon>add_circle</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              class="hide-mobile"
              [matMenuTriggerFor]="desktopMenu"
              aria-label="Menu"
            >
              <mat-icon>more_vert</mat-icon>
            </button>
            <mat-menu #desktopMenu="matMenu">
              <button mat-menu-item type="button" (click)="openAddNzb()">
                <mat-icon>upload</mat-icon>
                <span>Upload NZB</span>
              </button>
              <button mat-menu-item type="button" (click)="togglePause()">
                <mat-icon>{{ paused() ? 'play_arrow' : 'pause' }}</mat-icon>
                <span>{{ paused() ? 'Resume' : 'Pause' }}</span>
              </button>
              @if (!paused()) {
                <button mat-menu-item type="button" [matMenuTriggerFor]="pauseForMenu">
                  <mat-icon>schedule</mat-icon>
                  <span>Pause for…</span>
                </button>
              }
            </mat-menu>
            <mat-menu #pauseForMenu="matMenu">
              @for (opt of pauseTimerOptions; track opt.secs) {
                <button mat-menu-item type="button" (click)="pauseFor(opt.secs)">{{ opt.label }}</button>
              }
              <div class="pause-custom" (click)="$event.stopPropagation()">
                <input
                  type="number"
                  min="1"
                  placeholder="min"
                  [(ngModel)]="customPauseMin"
                  (keydown.enter)="pauseForCustom()"
                />
                <button type="button" class="btn sm primary" (click)="pauseForCustom()">Go</button>
              </div>
            </mat-menu>
            <button mat-button type="button" class="hide-mobile" (click)="onLogout()">Sign out</button>
          </div>
        </header>

        <nav class="app-sidebar" aria-label="Primary">
          <div class="sidebar-wrap">
            <div class="sidebar-section">
              <a routerLink="/queue" routerLinkActive="active">Queue</a>
              <a routerLink="/history" routerLinkActive="active">History</a>
              <a routerLink="/groups" routerLinkActive="active">Search</a>
              <a routerLink="/rss" routerLinkActive="active">RSS</a>
              @if (webdavEnabled()) {
                <a routerLink="/media" routerLinkActive="active">Media</a>
              }
              <a routerLink="/logs" routerLinkActive="active">Logs</a>
              <a routerLink="/settings" routerLinkActive="active">Settings</a>
            </div>
            <div class="sidebar-footer">
              <span class="ver">v{{ version }}</span>
            </div>
          </div>
        </nav>

        <main class="app-main-scroll has-bottom-nav page-main">
          <div class="content-wrap scene-pad">
            <h1 class="nav-title-large hide-desktop">{{ pageTitle() }}</h1>
            <router-outlet />
          </div>
        </main>

        <nav class="app-bottom-nav" aria-label="Main">
          <a routerLink="/queue" routerLinkActive="active" #q="routerLinkActive" [class.active]="q.isActive">
            <span class="mi material-icons" aria-hidden="true">download</span>
            Queue
          </a>
          <a routerLink="/history" routerLinkActive="active" #h="routerLinkActive" [class.active]="h.isActive">
            <span class="mi material-icons" aria-hidden="true">history</span>
            History
          </a>
          <a routerLink="/groups" routerLinkActive="active" #g="routerLinkActive" [class.active]="g.isActive">
            <span class="mi material-icons" aria-hidden="true">search</span>
            Search
          </a>
          <a routerLink="/settings" routerLinkActive="active" #s="routerLinkActive" [class.active]="s.isActive">
            <span class="mi material-icons" aria-hidden="true">settings</span>
            Settings
          </a>
          <button type="button" class="more-tab" (click)="openMoreSheet()">
            <span class="mi material-icons" aria-hidden="true">more_horiz</span>
            More
          </button>
        </nav>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
        overflow: hidden;
      }
      .shell {
        display: grid;
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr;
        height: 100vh;
        min-width: 0;
        overflow: hidden;
      }
      .app-topbar {
        grid-column: 1 / -1;
        grid-row: 1;
      }
      .app-main-scroll {
        grid-column: 1;
        grid-row: 2;
        min-width: 0;
      }
      .topbar-wrap {
        display: flex;
        align-items: center;
        width: 100%;
        max-width: none;
        min-width: 0;
        margin: 0 auto;
        min-height: 52px;
        padding: 4px 12px;
        box-sizing: border-box;
        gap: 8px;
        flex-wrap: wrap;
      }
      .content-wrap {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      .spacer {
        flex: 1;
      }
      .status {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }
      .hide-mobile {
        display: none;
      }
      @media (min-width: 1024px) {
        .shell {
          grid-template-columns: 260px 1fr;
          grid-template-rows: auto 1fr;
        }
        .app-sidebar {
          display: block;
          grid-column: 1;
          grid-row: 2;
          min-width: 0;
          border-right: 1px solid var(--line);
          background: color-mix(in srgb, var(--bg) 82%, transparent);
          -webkit-backdrop-filter: blur(12px) saturate(1.1);
          backdrop-filter: blur(12px) saturate(1.1);
          overflow: auto;
        }
        .sidebar-wrap {
          position: sticky;
          top: 0;
          height: calc(100vh - 52px);
          min-height: 0;
          display: flex;
          flex-direction: column;
          padding: 12px;
          box-sizing: border-box;
          gap: 10px;
        }
        .sidebar-section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .app-sidebar a {
          display: flex;
          align-items: center;
          padding: 10px 10px;
          border-radius: 10px;
          text-decoration: none;
          color: var(--text-secondary);
          font: var(--font-subheadline);
          white-space: nowrap;
        }
        .app-sidebar a:hover {
          color: var(--text);
          background: var(--panel2);
        }
        .app-sidebar a.active {
          color: var(--tint);
          font-weight: 600;
          background: color-mix(in srgb, var(--tint) 10%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 40%, var(--line));
        }
        .sidebar-footer {
          margin-top: auto;
          padding-top: 10px;
          border-top: 1px solid var(--line);
          color: var(--mute);
          font: var(--font-footnote);
        }
        .app-main-scroll {
          grid-column: 2;
          grid-row: 2;
        }
        .hide-mobile {
          display: inline-flex;
        }
        .app-topbar--mobile-only {
          display: none !important;
        }
        .hide-desktop {
          display: none !important;
        }
      }
      @media (max-width: 1023px) {
        .hide-desktop {
          display: block;
        }
        .app-sidebar {
          display: none;
        }
      }
      .more-tab {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 6px 4px;
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
        font: inherit;
      }
      .more-tab .mi {
        font-size: 22px;
      }
      .pause-custom {
        display: flex;
        gap: 8px;
        padding: 8px 16px;
        align-items: center;
      }
      .pause-custom input {
        width: 64px;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--line);
        background: var(--panel2);
        color: var(--text);
      }
      .app-topbar--live.warn .live-dot {
        background: var(--warn);
        animation: none;
        opacity: 0.9;
      }
    `,
  ],
})
export class App implements OnInit, OnDestroy {
  readonly version = '1.1.0';

  private api = inject(ApiService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private addNzbService = inject(AddNzbService);
  private bottomSheet = inject(MatBottomSheet);
  /** Theme + width: keep providers alive */
  readonly widthMode = inject(WidthModeService);
  private readonly _theme = inject(ThemeService);

  speed = signal(0);
  paused = signal(false);
  queueCount = signal(0);
  diskFree = signal(0);
  webdavEnabled = signal(false);
  authenticated = signal(false);
  pageTitle = signal('Queue');

  customPauseMin: number | null = null;
  readonly pauseTimerOptions = [
    { label: '5 minutes', secs: 5 * 60 },
    { label: '15 minutes', secs: 15 * 60 },
    { label: '30 minutes', secs: 30 * 60 },
    { label: '1 hour', secs: 60 * 60 },
    { label: '2 hours', secs: 2 * 60 * 60 },
  ];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private addSub = this.addNzbService.panelToggle$.subscribe(() => this.openAddNzb());

  ngOnInit(): void {
    this.authenticated.set(this.authService.isLoggedIn());
    this.pollStatus();
    this.pollTimer = setInterval(() => this.pollStatus(), 2000);
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.setPageTitle());
    this.setPageTitle();
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.addSub.unsubscribe();
  }

  private setPageTitle(): void {
    const path = this.router.url.split('?')[0];
    const map: Record<string, string> = {
      '/queue': 'Queue',
      '/history': 'History',
      '/groups': 'Search',
      '/rss': 'RSS',
      '/media': 'Media',
      '/logs': 'Logs',
      '/settings': 'Settings',
      '/welcome': 'Welcome',
    };
    this.pageTitle.set(map[path] ?? 'rustnzb');
  }

  pollStatus(): void {
    this.authenticated.set(this.authService.isLoggedIn());
    if (!this.authenticated()) return;
    this.api.get<StatusResponse>('/status').subscribe({
      next: s => {
        this.speed.set(s.speed_bps);
        this.paused.set(s.paused);
        this.queueCount.set(s.queue_size);
        this.diskFree.set(s.disk_free_bytes);
        this.webdavEnabled.set(!!s.webdav_enabled);
      },
      error: () => {},
    });
  }

  onLogout(): void {
    this.authenticated.set(false);
    this.authService.logout().subscribe({
      complete: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }

  openAddNzb(): void {
    const open = () => {
      this.bottomSheet.open(AddNzbSheetComponent, {
        data: { categories: [] },
        panelClass: 'ruddarr-bottom-sheet',
      });
    };
    if (this.router.url.split('?')[0] !== '/queue') {
      void this.router.navigate(['/queue']).then(() => open());
    } else {
      open();
    }
  }

  openMoreSheet(): void {
    this.bottomSheet.open(MoreMenuSheetComponent, {
      data: { webdavEnabled: this.webdavEnabled(), version: this.version },
      panelClass: 'ruddarr-bottom-sheet',
    });
  }

  togglePause(): void {
    const action = this.paused() ? '/queue/resume' : '/queue/pause';
    this.api.post(action).subscribe(() => this.pollStatus());
  }

  pauseFor(secs: number): void {
    this.api.post(`/queue/pause-for?duration_secs=${secs}`).subscribe(() => this.pollStatus());
  }

  pauseForCustom(): void {
    const mins = this.customPauseMin;
    if (!mins || mins <= 0) return;
    this.pauseFor(Math.round(mins * 60));
    this.customPauseMin = null;
  }

  formatSpeed(bps: number): string {
    if (bps === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bps) / Math.log(k));
    return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
