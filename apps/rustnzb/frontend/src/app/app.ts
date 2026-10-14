import { Component, OnInit, OnDestroy, Signal, computed, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from './core/services/api.service';
import { AuthService } from './core/services/auth.service';
import { StatusResponse } from './core/models/queue.model';
import { formatBytes, formatSpeed } from './core/format';
import { AddNzbService } from './core/services/add-nzb.service';
import { WidthModeService } from './core/services/width-mode.service';
import { PauseStateService } from './core/services/pause-state.service';
import { ThemeService } from './core/services/theme.service';
import { showHttpError } from './core/http/http-error';

export function isDemoPath(pathname: string): boolean {
  return pathname === '/demo' || pathname.startsWith('/demo/');
}

// Pages that render full-screen, without the app chrome, even when signed in.
export function isBareRoute(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return path === '/login' || path === '/welcome';
}

const PAGE_TITLES: Record<string, string> = {
  '/queue': 'Queue',
  '/history': 'History',
  '/groups': 'Search',
  '/rss': 'RSS',
  '/media': 'Media',
  '/logs': 'Logs',
  '/statistics': 'Statistics',
  '/settings': 'Settings',
};

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
    @if (!showChrome()) {
      <router-outlet />
    } @else {
      <div class="shell">
        <header class="app-topbar">
          <div class="topbar-wrap">
            <a routerLink="/queue" class="brand">rust<span>nzb</span></a>
            @if (version()) {
              <span class="ver app-topbar--mobile-only" [attr.title]="'v' + version()">v{{ shortVersion() }}</span>
            }
            <div class="spacer"></div>
            @if (demoMode) {
              <a class="demo-exit" href="/">Exit demo</a>
            }
            @if (statusLoaded()) {
            <div class="status hide-mobile">
              <span class="app-topbar--live pill" [class.warn]="paused()">
                <span class="live-dot" [class.pulse]="!paused() && speed() > 0" aria-hidden="true"></span>
                <span>{{ paused() ? 'Paused' : 'Live' }}</span>
                <span class="sep" aria-hidden="true">·</span>
                <span class="tabular-nums">{{ formatSpeed(speed()) }}</span>
                <span class="sep" aria-hidden="true">·</span>
                <span class="tabular-nums">{{ queueCount() }} queued</span>
              </span>
              <span class="pill tabular-nums">{{ formatBytes(diskFree()) }} free</span>
            </div>
            }
            <button
              mat-icon-button
              type="button"
              class="app-topbar--mobile-only"
              [disabled]="!statusLoaded()"
              (click)="togglePause()"
              [attr.aria-label]="paused() ? 'Resume downloads' : 'Pause downloads'"
            >
              <mat-icon>{{ paused() ? 'play_circle' : 'pause_circle' }}</mat-icon>
            </button>
            <button
              mat-icon-button
              type="button"
              class="app-topbar--mobile-only"
              (click)="onAddNzb()"
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
              <button mat-menu-item type="button" (click)="onAddNzb()">
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
              <button mat-menu-item type="button" (click)="toggleWidthMode()">
                <mat-icon>{{ widthMode.mode() === 'compact' ? 'width_full' : 'width_normal' }}</mat-icon>
                <span>{{ widthMode.mode() === 'compact' ? 'Expanded layout' : 'Compact layout' }}</span>
              </button>
            </mat-menu>
            <mat-menu #pauseForMenu="matMenu">
              @for (opt of pauseTimerOptions; track opt.secs) {
                <button mat-menu-item type="button" (click)="pauseFor(opt.secs)">{{ opt.label }}</button>
              }
              <div class="pause-custom" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
                <input
                  type="number"
                  min="1"
                  placeholder="min"
                  aria-label="Custom pause duration in minutes"
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
              <a routerLink="/statistics" routerLinkActive="active">Statistics</a>
              <a routerLink="/logs" routerLinkActive="active">Logs</a>
              <a routerLink="/settings" routerLinkActive="active">Settings</a>
            </div>
            @if (version()) {
              <div class="sidebar-footer">
                <span class="ver">v{{ version() }}</span>
              </div>
            }
          </div>
        </nav>

        <main class="app-main-scroll has-bottom-nav page-main">
          <div class="content-wrap scene-pad">
            <h1 class="nav-title-large hide-desktop">{{ pageTitle() }}</h1>
            <router-outlet />
          </div>
        </main>

        <nav class="app-bottom-nav" aria-label="Main">
          <a routerLink="/queue" routerLinkActive="active">
            <span class="mi material-icons" aria-hidden="true">download</span>
            Queue
          </a>
          <a routerLink="/history" routerLinkActive="active">
            <span class="mi material-icons" aria-hidden="true">history</span>
            History
          </a>
          <a routerLink="/groups" routerLinkActive="active">
            <span class="mi material-icons" aria-hidden="true">search</span>
            Search
          </a>
          <a routerLink="/settings" routerLinkActive="active">
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
      /* dvh: on phones 100vh includes the area behind the browser toolbars. */
      :host {
        display: block;
        height: 100dvh;
        overflow-y: auto;
      }
      .shell {
        display: grid;
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr;
        height: 100dvh;
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
          height: calc(100dvh - 52px);
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
        min-height: 48px;
        background: none;
        border: none;
        color: var(--text-secondary);
        font: inherit;
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
      }
      .more-tab .mi {
        font-size: 22px;
        line-height: 1;
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
      .app-topbar .ver {
        font: var(--font-caption);
        color: var(--mute);
        white-space: nowrap;
      }
      .demo-exit {
        border: 1px solid var(--tint);
        border-radius: 8px;
        color: var(--tint);
        padding: 4px 10px;
        text-decoration: none;
        font: var(--font-footnote);
        font-weight: 600;
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
  readonly demoMode = isDemoPath(window.location.pathname);
  version = signal('');
  /** False until the first /status answer, so the header never shows placeholder zeros. */
  readonly statusLoaded = signal(false);
  /** Release number without the `+<git sha>` build suffix. */
  readonly shortVersion = computed(() => this.version().split('+')[0]);

  speed = signal(0);
  paused: WritableSignal<boolean>;
  queueCount = signal(0);
  diskFree = signal(0);
  webdavEnabled = signal(false);
  readonly authenticated: Signal<boolean>;
  private readonly currentUrl = signal('');
  // Keyed on the route as well as the session: swapping branches rebuilds the
  // router outlet, and doing that under /login mid-submit would re-run the
  // login page's redirect and race the navigation to /welcome.
  readonly showChrome = computed(() => this.authenticated() && !isBareRoute(this.currentUrl()));
  readonly pageTitle = computed(
    () => PAGE_TITLES[this.currentUrl().split(/[?#]/)[0]] ?? 'rustnzb',
  );
  customPauseMin: number | null = null;
  readonly pauseTimerOptions = [
    { label: '5 minutes', secs: 5 * 60 },
    { label: '15 minutes', secs: 15 * 60 },
    { label: '30 minutes', secs: 30 * 60 },
    { label: '1 hour', secs: 60 * 60 },
    { label: '2 hours', secs: 2 * 60 * 60 },
  ];
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly addSub;

  constructor(
    private api: ApiService,
    private authService: AuthService,
    private router: Router,
    addNzbService: AddNzbService,
    public widthMode: WidthModeService,
    readonly theme: ThemeService,
    pauseState: PauseStateService,
    private snack: MatSnackBar,
    private bottomSheet?: MatBottomSheet,
  ) {
    this.paused = pauseState.paused;
    this.authenticated = authService.authenticated;
    this.currentUrl.set(router.url);
    router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
    // Pages ask for the add sheet through the shared service.
    this.addSub = addNzbService.panelToggle$.subscribe(() => void this.openAddSheet());
  }

  ngOnInit(): void {
    this.schedulePoll(0);
  }

  // The session is verified asynchronously after load; until then poll fast so
  // the header shows real values right away instead of after the first 2s tick.
  private schedulePoll(delayMs: number): void {
    this.pollTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.pollStatus();
      this.schedulePoll(this.statusLoaded() ? 2000 : 250);
    }, delayMs);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.addSub.unsubscribe();
  }

  pollStatus(): void {
    if (!this.authenticated()) return;
    // A background tab needs no live header; the next visible tick catches up.
    if (typeof document !== 'undefined' && document.hidden) return;
    this.api.get<StatusResponse>('/status').subscribe({
      next: (s) => {
        this.speed.set(s.speed_bps);
        this.paused.set(s.paused);
        this.queueCount.set(s.queue_size);
        this.diskFree.set(s.disk_space_free);
        this.webdavEnabled.set(!!s.webdav_enabled);
        this.statusLoaded.set(true);
        if (s.version) this.version.set(s.version);
      },
      error: () => {},
    });
  }

  onLogout(): void {
    this.authService.logout().subscribe({
      complete: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
    });
  }

  onAddNzb(): void {
    void this.openAddSheet();
  }

  // Sheets are loaded on first use to keep them out of the initial bundle.
  private async openAddSheet(): Promise<void> {
    if (!this.bottomSheet) return;
    const { AddNzbSheetComponent } = await import('./features/queue/add-nzb-sheet.component');
    this.bottomSheet.open(AddNzbSheetComponent, {
      data: { categories: [] },
      panelClass: 'ruddarr-bottom-sheet',
    });
  }

  async openMoreSheet(): Promise<void> {
    if (!this.bottomSheet) return;
    const { MoreMenuSheetComponent } = await import('./shell/more-menu-sheet.component');
    this.bottomSheet.open(MoreMenuSheetComponent, {
      data: { webdavEnabled: this.webdavEnabled(), version: this.version() },
      panelClass: 'ruddarr-bottom-sheet',
    });
  }

  toggleWidthMode(): void {
    this.widthMode.set(this.widthMode.mode() === 'compact' ? 'expanded' : 'compact');
  }

  togglePause(): void {
    const wasPaused = this.paused();
    const action = wasPaused ? '/queue/resume' : '/queue/pause';
    // Update every consumer immediately; the backend remains authoritative
    // and the next status poll corrects this if the request fails.
    this.paused.set(!wasPaused);
    this.api.post(action).subscribe({
      next: () => this.pollStatus(),
      error: (err) => {
        this.paused.set(wasPaused);
        this.pollStatus();
        showHttpError(
          this.snack,
          err,
          wasPaused ? 'Failed to resume downloads' : 'Failed to pause downloads',
        );
      },
    });
  }

  pauseFor(secs: number): void {
    this.api.post(`/queue/pause-for?duration_secs=${secs}`).subscribe({
      next: () => this.pollStatus(),
      error: (err) => showHttpError(this.snack, err, 'Failed to pause downloads'),
    });
  }

  pauseForCustom(): void {
    const mins = this.customPauseMin;
    if (!mins || mins <= 0) return;
    this.pauseFor(Math.round(mins * 60));
    this.customPauseMin = null;
  }

  formatSpeed(bps: number): string {
    return formatSpeed(bps);
  }

  formatBytes(bytes: number): string {
    return formatBytes(bytes);
  }
}
