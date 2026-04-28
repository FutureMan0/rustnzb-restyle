import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { StatusResponse } from '../../core/models/queue.model';
import { ThemeService, type TintName } from '../../core/services/theme.service';

interface ServerConfig {
  id: string; name: string; host: string; port: number; ssl: boolean; ssl_verify: boolean;
  username: string | null; password: string | null; connections: number; priority: number;
  enabled: boolean; retention: number; pipelining: number; optional: boolean; compress: boolean;
  ramp_up_delay_ms: number; proxy_url: string | null;
}

interface CategoryConfig {
  name: string; output_dir: string | null; post_processing: number;
}

interface ServerStats {
  server_id: string; server_name: string;
  total_bytes: number; today_bytes: number; week_bytes: number; month_bytes: number;
  total_ok: number; today_ok: number; week_ok: number; month_ok: number;
  total_fail: number; today_fail: number; week_fail: number; month_fail: number;
  last_active: string | null;
}

type Tab =
  | 'servers' | 'rss-cfg'
  | 'categories' | 'postproc' | 'paths' | 'dav'
  | 'general' | 'api' | 'telemetry' | 'display' | 'about';

interface DavConfig {
  auto_send_all: boolean;
  category_rules: string[];
  username: string | null;
  password: string | null;
  api_key: string | null;
}

function emptyServer(): ServerConfig {
  return {
    id: '', name: '', host: '', port: 563, ssl: true, ssl_verify: true,
    username: null, password: null, connections: 8, priority: 0,
    enabled: true, retention: 0, pipelining: 16, optional: false, compress: false,
    ramp_up_delay_ms: 250, proxy_url: null,
  };
}

function emptyCategory(): CategoryConfig {
  return { name: '', output_dir: null, post_processing: 3 };
}

@Component({
  selector: 'app-settings-view',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatSnackBarModule],
  template: `
    <div class="settings-shell">

      <!-- Sidebar -->
      <aside class="settings-side">
        <div class="sg">Connection</div>
        <button [class.active]="tab === 'servers'"  (click)="tab = 'servers'">News servers</button>
        <button [class.active]="tab === 'rss-cfg'"  (click)="tab = 'rss-cfg'">RSS feeds</button>

        <div class="sg">Downloads</div>
        <button [class.active]="tab === 'categories'" (click)="tab = 'categories'">Categories</button>
        <button [class.active]="tab === 'postproc'"   (click)="tab = 'postproc'">Post-processing</button>
        <button [class.active]="tab === 'paths'"      (click)="tab = 'paths'">Paths &amp; disk</button>
        @if (webdavEnabled()) {
          <button [class.active]="tab === 'dav'" (click)="tab = 'dav'">Media Library (DAV)</button>
        }

        <div class="sg">System</div>
        <button [class.active]="tab === 'general'"    (click)="tab = 'general'">General</button>
        <button [class.active]="tab === 'api'"        (click)="tab = 'api'">API &amp; SABnzbd compat</button>
        <button [class.active]="tab === 'telemetry'"  (click)="tab = 'telemetry'">Logging &amp; telemetry</button>
        <div class="sg">Interface</div>
        <button [class.active]="tab === 'display'"   (click)="tab = 'display'">Display</button>
        <button [class.active]="tab === 'about'"      (click)="tab = 'about'">About</button>
      </aside>

      <div class="settings-main">
        <div class="settings-tab-select hide-desktop">
          <label for="settingsTab">Section</label>
          <select id="settingsTab" [ngModel]="tab" (ngModelChange)="onTabSelect($event)">
            <option value="servers">News servers</option>
            <option value="rss-cfg">RSS feeds</option>
            <option value="categories">Categories</option>
            <option value="postproc">Post-processing</option>
            <option value="paths">Paths &amp; disk</option>
            @if (webdavEnabled()) { <option value="dav">Media Library (DAV)</option> }
            <option value="general">General</option>
            <option value="api">API &amp; SABnzbd</option>
            <option value="telemetry">Logging &amp; telemetry</option>
            <option value="display">Display</option>
            <option value="about">About</option>
          </select>
        </div>

        <!-- =========== SERVERS =========== -->
        @if (tab === 'servers') {
          <div class="section-head">
            <div>
              <h2>News servers</h2>
              <div class="sub">Priority 0 is tried first; higher priorities fill gaps.</div>
            </div>
            @if (!editingServer) {
              <button class="btn primary" (click)="addServer()">+ Add server</button>
            }
          </div>

          <!-- Server list -->
          <div class="panel">
            @for (s of servers(); track s.id) {
              <div class="srv-row">
                <div class="drag">⋮⋮</div>
                <div>
                  <div class="title" [class.dim]="!s.enabled">
                    @if (s.enabled) {
                      <span class="srv-online-dot" title="Enabled"></span>
                    }
                    {{ s.name || s.host }}
                    <span class="pill" [class.ok]="s.enabled" [class.warn]="!s.enabled" style="margin-left:6px">
                      ● {{ s.enabled ? 'enabled' : 'disabled' }}
                    </span>
                    @if (s.optional) { <span class="tag" style="margin-left:4px">backup</span> }
                  </div>
                  <div class="host">
                    {{ s.ssl ? 'NNTPS' : 'NNTP' }} · {{ s.host }}:{{ s.port }}
                    @if (s.username) { · user <code>{{ s.username }}</code> }
                    · {{ s.connections }} conns · pipeline {{ s.pipelining }}
                    @if (s.ssl) { · TLS 1.3 }
                  </div>
                  <div class="meters">
                    <span>priority <b>{{ s.priority }}</b></span>
                    <span>retention <b>{{ s.retention }} d</b></span>
                    <span>ramp-up <b>{{ s.ramp_up_delay_ms }} ms</b></span>
                    @if (s.compress) { <span><b>compression</b></span> }
                    @let st = serverStats()[s.id];
                    @if (st && st.total_bytes > 0) {
                      <span style="color:var(--accent)">↓ {{ fmtBytes(st.total_bytes) }} total</span>
                    }
                  </div>
                </div>
                <div class="actions">
                  <button class="btn sm" (click)="testServer(s.id)">Test</button>
                  <button class="btn sm" (click)="toggleServerEnabled(s)">
                    {{ s.enabled ? 'Disable' : 'Enable' }}
                  </button>
                  <button class="btn sm" (click)="editServer(s)">Edit</button>
                  <button class="btn sm" (click)="cloneServer(s)">Clone</button>
                  <button class="btn sm danger" (click)="deleteServer(s.id)">Remove</button>
                  <button class="btn sm" [class.active]="expandedStatsId === s.id" (click)="toggleStats(s.id)">Stats</button>
                </div>
              </div>
              @if (expandedStatsId === s.id) {
                @let st = serverStats()[s.id];
                <div class="srv-stats-panel">
                  @if (st) {
                    <div class="srv-stats-grid">
                      <div class="srv-stats-col">
                        <div class="srv-stats-heading">Bandwidth</div>
                        <div class="srv-stats-row"><span>Total</span><b>{{ fmtBytes(st.total_bytes) }}</b></div>
                        <div class="srv-stats-row"><span>Today</span><b>{{ fmtBytes(st.today_bytes) }}</b></div>
                        <div class="srv-stats-row"><span>This week</span><b>{{ fmtBytes(st.week_bytes) }}</b></div>
                        <div class="srv-stats-row"><span>This month</span><b>{{ fmtBytes(st.month_bytes) }}</b></div>
                      </div>
                      <div class="srv-stats-col">
                        <div class="srv-stats-heading">Article availability</div>
                        <div class="srv-stats-row"><span>Total</span><b>{{ fmtAvail(st.total_ok, st.total_fail) }}</b></div>
                        <div class="srv-stats-row"><span>Today</span><b>{{ fmtAvail(st.today_ok, st.today_fail) }}</b></div>
                        <div class="srv-stats-row"><span>This week</span><b>{{ fmtAvail(st.week_ok, st.week_fail) }}</b></div>
                        <div class="srv-stats-row"><span>This month</span><b>{{ fmtAvail(st.month_ok, st.month_fail) }}</b></div>
                      </div>
                    </div>
                    @if (st.last_active) {
                      <div style="font-size:11px;color:var(--mute);margin-top:6px">Last activity: {{ st.last_active }}</div>
                    }
                  } @else {
                    <div style="color:var(--mute);font-size:12px">No data yet — stats accumulate as downloads complete.</div>
                  }
                </div>
              }
            }
            @if (servers().length === 0 && !editingServer) {
              <div class="empty">No servers configured. Click <b>+ Add server</b> to get started.</div>
            }
          </div>

          <!-- Edit form -->
          @if (editingServer) {
            <div class="panel">
              <h3>{{ editingServerId ? 'Edit server' : 'Add server' }}</h3>
              <div class="body">
                <div class="form">
                  <label>Name</label>
                  <input type="text" [(ngModel)]="editingServer.name" placeholder="news-primary" />

                  <label>Host</label>
                  <input type="text" [(ngModel)]="editingServer.host" placeholder="news.example.com" />

                  <label>Port</label>
                  <div class="inline">
                    <input type="number" [(ngModel)]="editingServer.port" />
                    <label class="check"><input type="checkbox" [(ngModel)]="editingServer.ssl" /> SSL (NNTPS)</label>
                    <label class="check"><input type="checkbox" [(ngModel)]="editingServer.ssl_verify" /> Verify cert</label>
                  </div>

                  <label>Username</label>
                  <input type="text" [(ngModel)]="editingServer.username" placeholder="(optional)" />

                  <label>Password</label>
                  <input type="password" [(ngModel)]="editingServer.password" placeholder="(optional)" />

                  <label>Connections</label>
                  <div class="inline">
                    <input type="number" [(ngModel)]="editingServer.connections" min="1" />
                    <label class="check"><input type="checkbox" [(ngModel)]="editingServer.enabled" /> Enabled</label>
                    <label class="check"><input type="checkbox" [(ngModel)]="editingServer.optional" /> Optional (skip on failure)</label>
                  </div>

                  <label>Priority</label>
                  <div class="inline">
                    <input type="number" [(ngModel)]="editingServer.priority" min="0" />
                    <span style="color:var(--mute);font-size:11px">0 = primary, higher = fallback</span>
                  </div>

                  <label>Pipelining</label>
                  <div class="inline">
                    <input type="number" [(ngModel)]="editingServer.pipelining" min="0" />
                    <span style="color:var(--mute);font-size:11px">Max inflight ARTICLE commands per conn</span>
                  </div>

                  <label>Ramp-up delay</label>
                  <div class="inline">
                    <input type="number" [(ngModel)]="editingServer.ramp_up_delay_ms" min="0" />
                    <span style="color:var(--mute);font-size:11px">ms between opening conns</span>
                  </div>

                  <label>Retention</label>
                  <div class="inline">
                    <input type="number" [(ngModel)]="editingServer.retention" min="0" />
                    <span style="color:var(--mute);font-size:11px">days (informational)</span>
                  </div>

                  <label>Compression</label>
                  <div class="check">
                    <input type="checkbox" [(ngModel)]="editingServer.compress" /> Enable header compression (XZVER)
                  </div>

                  <label>Proxy URL</label>
                  <input type="text" [(ngModel)]="editingServer.proxy_url" placeholder="socks5://user:pass@host:1080 (optional)" />
                </div>

                <div class="form-actions">
                  <button class="btn primary" (click)="saveServer()">Save</button>
                  <button class="btn" (click)="testEditingServer()">Test connection</button>
                  <button class="btn" (click)="cancelServerEdit()">Cancel</button>
                </div>
              </div>
            </div>
          }
        }

        <!-- =========== RSS GLOBAL OPTIONS =========== -->
        @if (tab === 'rss-cfg') {
          <div class="section-head">
            <div>
              <h2>RSS feeds</h2>
              <div class="sub">Manage feeds themselves on the <a routerLink="/rss">RSS page</a>.</div>
            </div>
          </div>

          <div class="panel">
            <h3>About RSS configuration</h3>
            <div class="body">
              <p style="margin:0;color:var(--mute);font-size:13px">
                Feed URLs, regex filters, poll intervals, and auto-enqueue are configured per feed on the
                <a routerLink="/rss">RSS page</a>. This section is reserved for global defaults
                (backoff, duplicate guard, User-Agent) and will move here once the backend exposes the
                corresponding endpoints.
              </p>
            </div>
          </div>
        }

        <!-- =========== CATEGORIES =========== -->
        @if (tab === 'categories') {
          <div class="section-head">
            <div>
              <h2>Categories</h2>
              <div class="sub">Bucket downloads into folders; each has its own post-processing level.</div>
            </div>
            @if (!editingCategory) {
              <button class="btn primary" (click)="addCategory()">+ Add category</button>
            }
          </div>

          <div class="panel">
            <div class="body flush">
              <table class="data tbl-desktop-only">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Output dir</th>
                    <th>Post-processing</th>
                    <th style="width:120px"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of categories(); track c.name) {
                    <tr>
                      <td><span class="tag cat">{{ c.name }}</span></td>
                      <td><code>{{ c.output_dir || '(default)' }}</code></td>
                      <td>{{ ppLabel(c.post_processing) }}</td>
                      <td>
                        <button class="row-action" (click)="editCategory(c)">edit</button>
                        <button class="row-action danger" (click)="deleteCategory(c.name)">del</button>
                      </td>
                    </tr>
                  }
                  @if (categories().length === 0 && !editingCategory) {
                    <tr><td colspan="4" class="empty-cell">No categories configured.</td></tr>
                  }
                </tbody>
              </table>
              <div class="list-mobile-only category-cards">
                @for (c of categories(); track c.name) {
                  <div class="group-box">
                    <div class="group-box__caption">Category</div>
                    <div class="group-box__title">{{ c.name }}</div>
                    <p class="cat-meta"><code class="out-dir">{{ c.output_dir || '(default)' }}</code></p>
                    <p class="cat-meta pp">{{ ppLabel(c.post_processing) }}</p>
                    <div class="cat-card-actions">
                      <button class="row-action" (click)="editCategory(c)">Edit</button>
                      <button class="row-action danger" (click)="deleteCategory(c.name)">Delete</button>
                    </div>
                  </div>
                }
                @if (categories().length === 0 && !editingCategory) {
                  <div class="empty">No categories configured.</div>
                }
              </div>
            </div>
          </div>

          @if (editingCategory) {
            <div class="panel">
              <h3>{{ editingCategoryOriginalName ? 'Edit' : 'Add' }} category</h3>
              <div class="body">
                <div class="form">
                  <label>Name</label>
                  <input type="text" [(ngModel)]="editingCategory.name" placeholder="movies" />

                  <label>Output dir</label>
                  <input type="text" [(ngModel)]="editingCategory.output_dir" placeholder="(optional — uses default if blank)" />

                  <label>Post-processing</label>
                  <select [(ngModel)]="editingCategory.post_processing">
                    <option [ngValue]="0">None</option>
                    <option [ngValue]="1">Repair (par2)</option>
                    <option [ngValue]="2">Unpack</option>
                    <option [ngValue]="3">Repair + Unpack</option>
                  </select>
                </div>
                <div class="form-actions">
                  <button class="btn primary" (click)="saveCategory()">Save</button>
                  <button class="btn" (click)="cancelCategoryEdit()">Cancel</button>
                </div>
              </div>
            </div>
          }
        }

        <!-- =========== POST-PROCESSING (static/overview) =========== -->
        @if (tab === 'postproc') {
          <div class="section-head">
            <div>
              <h2>Post-processing</h2>
              <div class="sub">Par2 repair (native Rust), unrar / 7z extraction, cleanup.</div>
            </div>
          </div>

          <div class="panel">
            <h3>Par2 repair <span class="hint">rust-par2 · no external binary</span></h3>
            <div class="body" style="font-size:13px;color:var(--mute)">
              Par2 behaviour is currently controlled per-category (see <a (click)="tab = 'categories'" style="cursor:pointer">Categories</a>).
              Global toggles (mode, memory limit, threads) will live here once the backend exposes them.
            </div>
          </div>

          <div class="panel">
            <h3>Extraction</h3>
            <div class="body" style="font-size:13px;color:var(--mute)">
              System <code>unrar</code> and <code>7z</code> are detected at startup.
              Run <code>--smoke-test</code> to verify the runtime tools.
            </div>
          </div>

          <div class="panel">
            <h3>Cleanup</h3>
            <div class="body" style="font-size:13px;color:var(--mute)">
              On success, .rar / .par2 are removed from the output directory; sample files under 50 MB
              are pruned. On failure, partial files are kept for retry.
            </div>
          </div>
        }

        <!-- =========== PATHS & DISK (read-only preview) =========== -->
        @if (tab === 'paths') {
          <div class="section-head">
            <div>
              <h2>Paths &amp; disk</h2>
              <div class="sub">Where rustnzb reads and writes. Set via CLI / TOML / env.</div>
            </div>
          </div>

          <div class="panel">
            <h3>Directories</h3>
            <div class="body" style="font-size:13px;line-height:1.8">
              <div><b>Data dir</b> — SQLite, queue state, job blobs · set via <code>RUSTNZB_DATA_DIR</code> or <code>--data-dir</code></div>
              <div><b>Downloads</b> — <code>/downloads/complete</code> (configured per category)</div>
              <div><b>Incomplete</b> — <code>/downloads/incomplete</code></div>
              <div><b>Watch dir</b> — <code>/downloads/watch</code> · <code>.nzb</code> drops auto-enqueue</div>
              <div><b>Temp</b> — <code>&lt;data&gt;/tmp</code></div>
              <div><b>Logs</b> — <code>&lt;data&gt;/logs</code></div>
            </div>
          </div>

          <div class="panel">
            <h3>Disk guards
              <span class="hint">history retention is editable under <a (click)="tab = 'general'" style="cursor:pointer">General</a></span>
            </h3>
            <div class="body">
              <div class="form">
                <label>Min free space</label>
                <div class="inline">
                  <input type="number" [(ngModel)]="minFreeSpaceGB" min="0" step="0.1" />
                  <span style="color:var(--mute)">GB · 0 = disabled · restart to apply</span>
                  <button class="btn sm" (click)="saveDiskGuards()">Save</button>
                </div>
                <label>Abort hopeless</label>
                <div class="inline">
                  <label class="toggle">
                    <input type="checkbox" [(ngModel)]="abortHopeless" (change)="saveDiskGuards()" />
                    <span>Abort downloads that cannot possibly complete</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        }

        <!-- =========== MEDIA LIBRARY (DAV) =========== -->
        @if (tab === 'dav') {
          <div class="section-head">
            <div>
              <h2>Media Library (DAV)</h2>
              <div class="sub">Stream completed downloads directly via WebDAV.</div>
            </div>
          </div>

          <div class="panel">
            <h3>WebDAV access</h3>
            <div class="body">
              @if (!davAuthConfigured()) {
                <div class="dav-warn">
                  ⚠ <b>WebDAV is currently unauthenticated.</b> Anyone who can reach
                  <code>{{ davBaseUrl() }}</code> can stream your media. Set a username
                  and password (or an API key) below.
                </div>
              }

              <div class="form">
                <label>DAV username</label>
                <div class="inline">
                  <input type="text" [(ngModel)]="davConfig.username" placeholder="e.g. plex" autocomplete="off" />
                </div>

                <label>DAV password</label>
                <div class="inline">
                  <input [type]="showDavPassword ? 'text' : 'password'" [(ngModel)]="davConfig.password" autocomplete="new-password" />
                  <button class="btn sm" (click)="showDavPassword = !showDavPassword" type="button">
                    {{ showDavPassword ? 'Hide' : 'Show' }}
                  </button>
                </div>

                <label>DAV API key</label>
                <div class="inline">
                  <input [type]="showDavApiKey ? 'text' : 'password'" [(ngModel)]="davConfig.api_key" autocomplete="off"
                         placeholder="X-Api-Key header value (optional)" />
                  <button class="btn sm" (click)="showDavApiKey = !showDavApiKey" type="button">
                    {{ showDavApiKey ? 'Hide' : 'Show' }}
                  </button>
                  <button class="btn sm" (click)="generateDavApiKey()" type="button">Generate</button>
                </div>
              </div>

              <div class="form-actions">
                <button class="btn primary" (click)="saveDavConfig()">Save</button>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>WebDAV URLs</h3>
            <div class="body">
              <div class="dim" style="margin-bottom: 8px;">
                Point a WebDAV client (Plex, Infuse, davfs2, rclone) at the root URL.
                Browseable subpaths are listed for reference — clients only need the root.
              </div>
              <div class="dir-table">
                <div class="dir-row">
                  <div><b>Root</b></div>
                  <div class="url-cell">
                    <code>{{ davBaseUrl() }}</code>
                    <button class="btn sm" (click)="copy(davBaseUrl())" type="button">Copy</button>
                  </div>
                </div>
                <div class="dir-row">
                  <div>Content</div>
                  <div class="url-cell">
                    <code>{{ davBaseUrl() }}/content</code>
                    <button class="btn sm" (click)="copy(davBaseUrl() + '/content')" type="button">Copy</button>
                  </div>
                </div>
                <div class="dir-row">
                  <div>NZBs</div>
                  <div class="url-cell">
                    <code>{{ davBaseUrl() }}/nzbs</code>
                    <button class="btn sm" (click)="copy(davBaseUrl() + '/nzbs')" type="button">Copy</button>
                  </div>
                </div>
                <div class="dir-row">
                  <div>Completed symlinks</div>
                  <div class="url-cell">
                    <code>{{ davBaseUrl() }}/completed-symlinks</code>
                    <button class="btn sm" (click)="copy(davBaseUrl() + '/completed-symlinks')" type="button">Copy</button>
                  </div>
                </div>
              </div>
              <div class="dim" style="margin-top: 10px; font-size: 11px;">
                Note: WebDAV clients must use the root URL <b>without a trailing slash</b>
                (Axum nest quirk). Append-paths shown above already follow this rule.
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>Auto-send to Media Library</h3>
            <div class="body">
              <div class="form">
                <label>Send all downloads</label>
                <div class="inline">
                  <label class="toggle">
                    <input type="checkbox" [(ngModel)]="davConfig.auto_send_all" (change)="onAutoSendAllChange()" />
                    <span>Automatically queue every completed download into the Media Library</span>
                  </label>
                </div>

                @if (!davConfig.auto_send_all) {
                  <label>Auto-send categories</label>
                  <div class="dav-cats">
                    @if (categories().length === 0) {
                      <span class="dim">No categories configured — add categories first.</span>
                    }
                    @for (cat of categories(); track cat.name) {
                      <label class="check">
                        <input type="checkbox"
                               [checked]="davConfig.category_rules.includes(cat.name)"
                               (change)="toggleDavCategory(cat.name, $event)" />
                        {{ cat.name }}
                      </label>
                    }
                  </div>
                }
              </div>
              <div class="form-actions">
                <button class="btn primary" (click)="saveDavConfig()">Save</button>
              </div>
            </div>
          </div>
        }

        <!-- =========== GENERAL =========== -->
        @if (tab === 'general') {
          <div class="section-head">
            <div>
              <h2>General</h2>
              <div class="sub">Global speed limit, concurrency, history retention.</div>
            </div>
          </div>

          <div class="panel">
            <h3>Speed &amp; concurrency</h3>
            <div class="body">
              <div class="form">
                <label>Global speed limit</label>
                <div class="inline">
                  <input type="number" [(ngModel)]="speedLimit" min="0" />
                  <span style="color:var(--mute)">bytes/sec · 0 = unlimited</span>
                  <button class="btn sm" (click)="saveSpeedLimit()">Save</button>
                </div>

                <label>Concurrent jobs</label>
                <div class="inline">
                  <input type="number" [(ngModel)]="maxActiveDownloads" min="1" />
                  <span style="color:var(--mute);font-size:11px">Max jobs in Downloading state</span>
                  <button class="btn sm" (click)="saveMaxActive()">Save</button>
                </div>

                <label>History retention</label>
                <div class="inline">
                  <input type="number" [(ngModel)]="historyRetention" min="0" />
                  <span style="color:var(--mute)">days · blank = keep all</span>
                  <button class="btn sm" (click)="saveRetention()">Save</button>
                </div>
              </div>
            </div>
          </div>
        }

        <!-- =========== API / SABnzbd =========== -->
        @if (tab === 'api') {
          <div class="section-head">
            <div>
              <h2>API &amp; SABnzbd compatibility</h2>
              <div class="sub">Native REST + drop-in SABnzbd API for Sonarr / Radarr / Lidarr.</div>
            </div>
          </div>

          <div class="panel">
            <h3>SABnzbd endpoint</h3>
            <div class="body" style="font-size:13px">
              <p style="margin:0 0 10px">Point Sonarr/Radarr at this host — category matching is done by category name.</p>
              <code>{{ sabnzbdExample }}</code>
              <div class="form" style="margin-top:16px">
                <label>Supported modes</label>
                <div style="font-size:12px">
                  <code>addfile</code> <code>addurl</code> <code>queue</code> <code>history</code>
                  <code>config</code> <code>fullstatus</code> <code>version</code>
                  <code>pause</code> <code>resume</code> <code>delete</code> <code>retry</code>
                </div>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>OpenAPI / Swagger</h3>
            <div class="body">
              <a href="/swagger-ui" target="_blank">Open <code>/swagger-ui</code></a>
              — generated by <code>utoipa</code> from the live route handlers.
            </div>
          </div>
        }

        <!-- =========== TELEMETRY =========== -->
        @if (tab === 'telemetry') {
          <div class="section-head">
            <div>
              <h2>Logging &amp; telemetry</h2>
              <div class="sub">tracing filters, file rotation, OpenTelemetry OTLP.</div>
            </div>
          </div>

          <div class="panel">
            <h3>tracing</h3>
            <div class="body" style="font-size:13px;line-height:1.8">
              Configured via env at startup: <code>RUSTNZB_LOG_LEVEL</code> (default <code>info</code>)
              or <code>RUST_LOG</code> for fine-grained per-target filters (e.g.
              <code>nzb_nntp=debug,nzb_web=info</code>). Live logs are on the
              <a routerLink="/logs">Logs page</a>.
            </div>
          </div>

          <div class="panel">
            <h3>OpenTelemetry (OTLP gRPC)</h3>
            <div class="body" style="font-size:13px;line-height:1.8">
              Enabled via <code>OTEL_ENABLED=true</code>, <code>OTEL_EXPORTER_OTLP_ENDPOINT</code>,
              <code>OTEL_SERVICE_NAME</code>. A mutable UI for these will land once the backend
              exposes a config endpoint.
            </div>
          </div>
        }

        <!-- =========== DISPLAY (Ruddarr-style theme) =========== -->
        @if (tab === 'display') {
          <div class="section-head">
            <div>
              <h2>Display</h2>
              <div class="sub">Color scheme and accent (stored in this browser).</div>
            </div>
          </div>

          <div class="panel">
            <h3>Appearance</h3>
            <div class="body">
              <div class="form">
                <label>Color scheme</label>
                <select
                  [ngModel]="theme.mode()"
                  (ngModelChange)="theme.setMode($any($event))"
                >
                  <option value="auto">Automatic</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="oled">OLED (Pure Black)</option>
                </select>
                <div class="help">Automatic follows the system (Light/Dark). OLED uses true black for AMOLED displays.</div>

                <label>Accent</label>
                <div class="tint-grid" role="list">
                  @for (tn of tintNames; track tn) {
                    <button
                      type="button"
                      class="tint-swatch"
                      [class.active]="theme.tint() === tn"
                      [attr.aria-pressed]="theme.tint() === tn"
                      [attr.aria-label]="'Accent ' + tn"
                      [attr.data-tint]="tn"
                      (click)="theme.setTint(tn)"
                    ></button>
                  }
                </div>

                <label class="live-preview-label">Live preview</label>
                <div
                  class="display-preview display-preview--live"
                  role="region"
                  aria-label="Live theme preview: reflects color scheme and accent"
                >
                  <div class="dp-frame">
                    <div class="dp-topbar">
                      <span class="dp-brand">rust<span class="dp-brand-t">nzb</span></span>
                      <span class="dp-live tabular-nums">
                        <span class="dp-live-dot" aria-hidden="true"></span>
                        {{ previewSpeedText() }}
                        <span class="dp-sep">·</span> 2 queued
                      </span>
                    </div>
                    <div class="dp-cards">
                      <div class="dp-card dp-card--stripe">
                        <div class="dp-card-lbl">Download speed</div>
                        <div class="dp-card-val tabular-nums">{{ previewSpeedText() }}</div>
                        <div class="dp-spark" aria-hidden="true">
                          <span class="dp-spark-b"></span>
                          <span class="dp-spark-b"></span>
                          <span class="dp-spark-b"></span>
                          <span class="dp-spark-b"></span>
                          <span class="dp-spark-b"></span>
                        </div>
                      </div>
                      <div class="dp-card">
                        <div class="dp-card-lbl">Queue</div>
                        <div class="dp-card-val tabular-nums">2</div>
                        <div class="dp-card-sub">1.2 GB left</div>
                      </div>
                    </div>
                    <div class="dp-chips" aria-hidden="true">
                      <span class="dp-chip dp-chip--on">All</span>
                      <span class="dp-chip">Active</span>
                    </div>
                    <div class="dp-row">
                      <span class="dp-dot" aria-hidden="true"></span>
                      <div class="dp-row-txt">
                        <div class="dp-title">Release.sample.1080p.mkv</div>
                        <div class="dp-meta">downloading <span class="dp-sep">·</span> 64% <span class="dp-sep">·</span> ETA 4m</div>
                      </div>
                      <div class="dp-vbar" aria-hidden="true"><div class="dp-vbar-fill"></div></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        }

        <!-- =========== ABOUT =========== -->
        @if (tab === 'about') {
          <div class="section-head">
            <div>
              <h2>About</h2>
              <div class="sub">Build info, versions, license.</div>
            </div>
          </div>

          <div class="panel">
            <div class="body">
              <div class="form">
                <label>Version</label><div>0.2.4</div>
                <label>Rust edition</label><div>2024</div>
                <label>Web framework</label><div>Axum 0.8 + Tower</div>
                <label>TLS</label><div>rustls 0.23 (ring)</div>
                <label>Database</label><div>SQLite · WAL mode · bundled</div>
                <label>License</label><div>MIT</div>
                <label>Source</label><div><a href="https://repo.indexarr.net/indexarr/rustnzb" target="_blank">repo.indexarr.net/indexarr/rustnzb</a></div>
              </div>
            </div>
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .settings-shell { display: grid; grid-template-columns: 220px 1fr; gap: 16px; }
    @media (max-width: 1023px) {
      .settings-shell { grid-template-columns: 1fr; }
      .settings-side { display: none; }
    }
    .settings-tab-select {
      margin-bottom: 16px;
    }
    .settings-tab-select label {
      display: block;
      font: var(--font-footnote);
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .settings-tab-select select {
      width: 100%;
      min-height: 44px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--panel2);
      color: var(--text);
      padding: 0 12px;
      font: var(--font-body);
    }
    @media (min-width: 1024px) {
      .hide-desktop { display: none !important; }
    }
    @media (max-width: 1023px) {
      .hide-desktop { display: block; }
    }
    .tint-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      grid-column: 1 / -1;
    }
    @media (min-width: 768px) {
      .tint-grid { grid-column: 2; }
    }
    .tint-swatch {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 2px solid var(--line);
      cursor: pointer;
      padding: 0;
      background: var(--sw, #888);
    }
    .tint-swatch.active {
      box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--tint);
    }
    .tint-swatch[data-tint='blue'] { --sw: #007aff; }
    .tint-swatch[data-tint='purple'] { --sw: #a855f7; }
    .tint-swatch[data-tint='green'] { --sw: #34c759; }
    .tint-swatch[data-tint='red'] { --sw: #ff3b30; }
    .tint-swatch[data-tint='orange'] { --sw: #ff9500; }
    .tint-swatch[data-tint='yellow'] { --sw: #ffcc00; }
    .tint-swatch[data-tint='mono'] { --sw: #8e8e93; }
    .tint-swatch[data-tint='brown'] { --sw: #a2845e; }
    .tint-swatch[data-tint='barbie'] { --sw: #ff69b4; }
    .tint-swatch[data-tint='plex'] { --sw: #e5a00d; }

    .settings-side {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px;
      height: fit-content;
      position: sticky;
      top: 16px;
    }
    .settings-side .sg {
      color: var(--mute);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .7px;
      padding: 14px 12px 4px;
      margin-top: 2px;
      border-top: 1px solid var(--line);
    }
    .settings-side .sg:first-child {
      border-top: none;
      padding-top: 6px;
      margin-top: 0;
    }
    .settings-side button {
      display: block;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      color: var(--text);
      padding: 7px 12px;
      border-radius: 5px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      opacity: .7;
    }
    .settings-side button:hover { opacity: 1; background: var(--panel2); }
    .settings-side button.active {
      opacity: 1;
      color: var(--tint);
      background: color-mix(in srgb, var(--tint) 14%, transparent);
      border-radius: var(--radius-pill);
      font-weight: 600;
    }
    .live-preview-label {
      color: var(--text-secondary);
      font: var(--font-footnote);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-top: 12px;
      grid-column: 1 / -1;
    }
    @media (min-width: 768px) {
      .live-preview-label { grid-column: 1; }
    }
    .display-preview--live {
      grid-column: 1 / -1;
      position: relative;
      border-radius: var(--radius-card);
      margin-top: 4px;
      overflow: hidden;
      background: var(--bg);
      box-shadow: var(--card-elev);
    }
    @media (min-width: 768px) {
      .display-preview--live { grid-column: 2; }
    }
    .dp-frame {
      padding: 12px 12px 14px;
      background: var(--bg);
    }
    .dp-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 32px;
      margin-bottom: 10px;
      padding: 4px 8px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--bg) 80%, transparent);
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
      box-shadow: 0 0 0 1px var(--line);
    }
    @supports not (backdrop-filter: blur(8px)) {
      .dp-topbar { background: var(--card); }
    }
    .dp-brand {
      font: 600 12px/1.2 -apple-system, 'Inter', sans-serif;
      color: var(--text);
    }
    .dp-brand-t { color: var(--tint); }
    .dp-live {
      font: 10px/1.2 -apple-system, sans-serif;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 2px;
      white-space: nowrap;
    }
    .dp-sep { opacity: 0.4; }
    .dp-live-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--tint);
      margin-right: 2px;
      animation: dp-pulse 1.2s var(--ease-out-soft) infinite;
    }
    @keyframes dp-pulse {
      0%,
      100% { transform: scale(1); opacity: 0.85; }
      50% { transform: scale(1.15); opacity: 0.5; }
    }
    .dp-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 10px;
    }
    .dp-card {
      position: relative;
      padding: 8px 10px;
      border-radius: 12px;
      background: var(--card);
      box-shadow: var(--card-elev);
      overflow: hidden;
    }
    .dp-card--stripe::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--tint);
      border-radius: 12px 0 0 12px;
    }
    .dp-card-lbl {
      font: 9px/1.2 -apple-system, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
    }
    .dp-card-val {
      font: 600 15px/1.2 -apple-system, 'Inter', sans-serif;
      color: var(--text);
      margin-top: 2px;
    }
    .dp-card-sub {
      font: 10px/1.2 -apple-system, sans-serif;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .dp-spark {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 22px;
      margin-top: 6px;
    }
    .dp-spark-b {
      flex: 1;
      min-width: 0;
      border-radius: 2px;
      background: var(--tint-soft);
      animation: dp-spark 1.4s var(--ease-out-soft) infinite;
    }
    .dp-spark-b:nth-child(1) { height: 40%; animation-delay: 0s; }
    .dp-spark-b:nth-child(2) { height: 65%; animation-delay: 0.1s; }
    .dp-spark-b:nth-child(3) { height: 90%; animation-delay: 0.2s; }
    .dp-spark-b:nth-child(4) { height: 55%; animation-delay: 0.3s; }
    .dp-spark-b:nth-child(5) { height: 70%; animation-delay: 0.4s; }
    @keyframes dp-spark {
      0%,
      100% { filter: brightness(0.95); }
      50% { filter: brightness(1.2); }
    }
    .dp-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .dp-chip {
      font: 10px/1.2 -apple-system, sans-serif;
      padding: 3px 10px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--line);
      color: var(--text-secondary);
    }
    .dp-chip--on {
      border-color: var(--tint);
      color: var(--tint);
      background: color-mix(in srgb, var(--tint) 12%, transparent);
    }
    .dp-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 12px;
      background: var(--card);
      box-shadow: var(--card-elev);
    }
    .dp-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--tint);
      flex-shrink: 0;
    }
    .dp-row-txt { min-width: 0; flex: 1; }
    .dp-title {
      font: 600 12px/1.25 -apple-system, sans-serif;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dp-meta {
      font: 10px/1.3 -apple-system, sans-serif;
      color: var(--text-secondary);
      margin-top: 2px;
    }
    .dp-vbar {
      width: 4px;
      height: 36px;
      border-radius: 2px;
      background: var(--panel2);
      position: relative;
      overflow: hidden;
      flex-shrink: 0;
    }
    .dp-vbar-fill {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--tint);
      height: 64%;
      animation: dp-vbar 2.2s var(--ease-out-soft) infinite;
    }
    @keyframes dp-vbar {
      0%,
      100% { height: 52%; }
      50% { height: 78%; }
    }
    .srv-online-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent2);
      margin-right: 8px;
      vertical-align: middle;
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent2) 40%, var(--line));
    }

    .settings-main { min-width: 0; padding-top: 10px; }

    /* Server rows */
    .srv-row {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
    }
    .srv-row:last-child { border: none; }
    .drag { color: var(--mute); cursor: grab; text-align: center; }
    .title { font-weight: 600; }
    .title.dim { color: var(--mute); }
    .host { color: var(--mute); font-size: 12px; margin-top: 2px; }
    .meters { display: flex; gap: 18px; align-items: center; font-size: 12px; color: var(--mute); margin-top: 6px; flex-wrap: wrap; }
    .meters b { color: var(--text); font-weight: 600; }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
    .btn.sm.active { background: var(--accent); color: #fff; border-color: var(--accent); }

    /* Server stats panel */
    .srv-stats-panel {
      grid-column: 1 / -1;
      padding: 12px 14px 14px 42px;
      background: var(--surface2, rgba(255,255,255,0.03));
      border-bottom: 1px solid var(--line);
    }
    .srv-stats-grid { display: flex; gap: 32px; flex-wrap: wrap; }
    .srv-stats-col { min-width: 200px; }
    .srv-stats-heading { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--mute); margin-bottom: 6px; }
    .srv-stats-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; color: var(--mute); padding: 2px 0; gap: 16px; }
    .srv-stats-row b { color: var(--text); font-weight: 600; white-space: nowrap; }

    .empty { padding: 24px; color: var(--mute); text-align: center; font-size: 13px; }
    .empty-cell { text-align: center; padding: 28px !important; color: var(--mute); font-size: 13px; }

    .form-actions { margin-top: 14px; display: flex; gap: 8px; }

    .dav-cats { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
    .dim { color: var(--mute); font-size: 12px; }

    .dav-warn {
      background: rgba(255, 180, 0, 0.08);
      border: 1px solid rgba(255, 180, 0, 0.35);
      color: var(--text);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 14px;
      font-size: 13px;
      line-height: 1.5;
    }
    .dav-warn code { background: rgba(0,0,0,0.25); padding: 1px 4px; border-radius: 3px; }
    .url-cell { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .url-cell code {
      background: var(--panel2, rgba(255,255,255,0.04));
      padding: 3px 7px;
      border-radius: 4px;
      font-size: 12px;
      word-break: break-all;
    }

    .dir-table { display: flex; flex-direction: column; gap: 0; font-size: 13px; }
    .dir-row { display: grid; grid-template-columns: 100px 1fr; gap: 8px 12px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--line); }
    .dir-row:last-child { border: none; }

    .category-cards { padding: 0 0 8px; }
    .category-cards .group-box { margin: 0 0 10px; }
    .cat-meta { margin: 6px 0 0; font: var(--font-subheadline); color: var(--text-secondary); }
    .out-dir { word-break: break-all; font-size: 12px; }
    .cat-card-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }

    @media (max-width: 1023px) {
      .srv-row {
        grid-template-columns: 1fr;
        align-items: stretch;
      }
      .srv-row .drag { display: none; }
      .srv-row .actions {
        justify-content: flex-start;
        padding-top: 10px;
        border-top: 1px solid var(--line);
      }
      .url-cell {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
      }
      .url-cell code { width: 100%; box-sizing: border-box; }
      .dir-row { grid-template-columns: 1fr; }
      .srv-stats-panel { padding-left: 14px; }
    }
  `],
})
export class SettingsViewComponent implements OnInit, OnDestroy {
  tab: Tab = 'servers';

  /** Drives the animated “live” speed readout in the theme preview. */
  private readonly previewTick = signal(0);
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  /** Fake MB/s for display preview (updates a few times per second). */
  readonly previewSpeedText = computed(() => {
    const t = this.previewTick();
    const mbps = 8.5 + 4.2 * Math.sin(t * 0.35) + 1.1 * Math.sin(t * 0.91);
    return mbps.toFixed(1) + ' MB/s';
  });

  readonly theme = inject(ThemeService);
  readonly tintNames: TintName[] = [
    'blue',
    'purple',
    'green',
    'red',
    'orange',
    'yellow',
    'mono',
    'brown',
    'barbie',
    'plex',
  ];

  readonly sabnzbdExample = `${typeof location !== 'undefined' ? location.origin : 'http://host:9090'}/sabnzbd/api?apikey=...&mode=queue`;

  onTabSelect(v: string): void {
    let t = v as Tab;
    if (t === 'dav' && !this.webdavEnabled()) t = 'servers';
    this.tab = t;
  }

  // Servers
  servers = signal<ServerConfig[]>([]);
  serverStats = signal<Record<string, ServerStats>>({});
  expandedStatsId: string | null = null;
  editingServer: ServerConfig | null = null;
  editingServerId: string | null = null;

  // Categories
  categories = signal<CategoryConfig[]>([]);
  editingCategory: CategoryConfig | null = null;
  editingCategoryOriginalName: string | null = null;

  // General
  speedLimit = 0;
  maxActiveDownloads = 3;
  historyRetention: number | null = null;

  // Disk guards
  minFreeSpaceGB = 1;
  abortHopeless = true;

  // Status / feature flags
  status = signal<StatusResponse | null>(null);
  webdavEnabled = computed(() => this.status()?.webdav_enabled ?? false);

  // DAV config
  davConfig: DavConfig = { auto_send_all: false, category_rules: [], username: null, password: null, api_key: null };
  showDavPassword = false;
  showDavApiKey = false;

  constructor(private api: ApiService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.previewTimer = setInterval(() => this.previewTick.update(n => n + 1), 500);
    this.loadServers();
    this.loadCategories();
    this.loadGeneralSettings();
    this.loadStatus();
  }

  ngOnDestroy(): void {
    if (this.previewTimer) {
      clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
  }

  loadStatus(): void {
    this.api.get<StatusResponse>('/status').subscribe({
      next: s => {
        this.status.set(s);
        if (s.webdav_enabled) this.loadDavConfig();
      },
      error: () => {},
    });
  }

  // ======================== SERVERS ========================

  loadServers(): void {
    this.api.get<ServerConfig[]>('/config/servers').subscribe({
      next: r => this.servers.set(r),
      error: () => {},
    });
    this.loadServerStats();
  }

  loadServerStats(): void {
    this.api.get<ServerStats[]>('/config/servers/stats').subscribe({
      next: r => {
        const map: Record<string, ServerStats> = {};
        for (const s of r) map[s.server_id] = s;
        this.serverStats.set(map);
      },
      error: () => {},
    });
  }

  toggleStats(id: string): void {
    this.expandedStatsId = this.expandedStatsId === id ? null : id;
    if (this.expandedStatsId) this.loadServerStats();
  }

  fmtBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  }

  fmtAvail(ok: number, fail: number): string {
    const total = ok + fail;
    if (total === 0) return '— (no data)';
    const pct = Math.round(ok / total * 100);
    return `${pct}% of ${this.fmtCount(total)} articles`;
  }

  fmtCount(n: number): string {
    if (n < 1000) return `${n}`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(0)}K`;
    return `${(n / 1_000_000).toFixed(1)}M`;
  }

  addServer(): void {
    this.editingServer = emptyServer();
    this.editingServerId = null;
  }

  editServer(s: ServerConfig): void {
    this.editingServer = { ...s };
    this.editingServerId = s.id;
  }

  cloneServer(s: ServerConfig): void {
    this.editingServer = { ...s, id: '', name: `${s.name} (copy)` };
    this.editingServerId = null;
  }

  cancelServerEdit(): void {
    this.editingServer = null;
    this.editingServerId = null;
  }

  saveServer(): void {
    if (!this.editingServer) return;
    const server = { ...this.editingServer };
    if (!server.host.trim()) {
      this.snack.open('Host is required', 'Close', { duration: 3000 });
      return;
    }
    if (!server.username) server.username = null;
    if (!server.password) server.password = null;

    if (this.editingServerId) {
      this.api.put(`/config/servers/${this.editingServerId}`, server).subscribe({
        next: () => {
          this.snack.open('Server updated', 'Close', { duration: 2000 });
          this.cancelServerEdit();
          this.loadServers();
        },
        error: () => this.snack.open('Failed to update server', 'Close', { duration: 3000 }),
      });
    } else {
      server.id = '';
      this.api.post('/config/servers', server).subscribe({
        next: () => {
          this.snack.open('Server added', 'Close', { duration: 2000 });
          this.cancelServerEdit();
          this.loadServers();
        },
        error: () => this.snack.open('Failed to add server', 'Close', { duration: 3000 }),
      });
    }
  }

  testServer(id: string): void {
    this.api.post<{ success: boolean; message: string }>(`/config/servers/${id}/test`).subscribe({
      next: r => this.snack.open(r.message, 'Close', { duration: 3000 }),
      error: () => this.snack.open('Test failed', 'Close', { duration: 3000 }),
    });
  }

  // Test the current (possibly unsaved) form values against the NNTP server.
  // Uses the inline test endpoint so users don't have to Save before verifying edits.
  testEditingServer(): void {
    if (!this.editingServer) return;
    const body = { ...this.editingServer };
    if (!body.username) body.username = null;
    if (!body.password) body.password = null;
    this.snack.open('Testing…', '', { duration: 1500 });
    this.api.post<{ success: boolean; message: string }>(`/config/servers/test-config`, body).subscribe({
      next: r => this.snack.open(r.message, 'Close', { duration: 4000 }),
      error: () => this.snack.open('Test failed', 'Close', { duration: 3000 }),
    });
  }

  toggleServerEnabled(s: ServerConfig): void {
    const updated = { ...s, enabled: !s.enabled };
    if (!updated.username) updated.username = null;
    if (!updated.password) updated.password = null;
    this.api.put(`/config/servers/${s.id}`, updated).subscribe({
      next: () => {
        this.loadServers();
        this.snack.open(
          updated.enabled ? 'Server enabled' : 'Server disabled',
          'Close',
          { duration: 2000 },
        );
      },
      error: () => this.snack.open('Failed to update server', 'Close', { duration: 3000 }),
    });
  }

  deleteServer(id: string): void {
    if (!confirm('Remove this server?')) return;
    this.api.delete(`/config/servers/${id}`).subscribe({
      next: () => {
        this.loadServers();
        this.snack.open('Server removed', 'Close', { duration: 2000 });
      },
      error: () => this.snack.open('Failed to delete server', 'Close', { duration: 3000 }),
    });
  }

  // ======================== CATEGORIES ========================

  loadCategories(): void {
    this.api.get<CategoryConfig[]>('/config/categories').subscribe({
      next: r => this.categories.set(r),
      error: () => {},
    });
  }

  addCategory(): void {
    this.editingCategory = emptyCategory();
    this.editingCategoryOriginalName = null;
  }

  editCategory(c: CategoryConfig): void {
    this.editingCategory = { ...c };
    this.editingCategoryOriginalName = c.name;
  }

  cancelCategoryEdit(): void {
    this.editingCategory = null;
    this.editingCategoryOriginalName = null;
  }

  saveCategory(): void {
    if (!this.editingCategory) return;
    const cat = { ...this.editingCategory };
    if (!cat.output_dir) cat.output_dir = null;

    if (this.editingCategoryOriginalName) {
      const encoded = encodeURIComponent(this.editingCategoryOriginalName);
      this.api.put(`/config/categories/${encoded}`, cat).subscribe({
        next: () => {
          this.snack.open('Category updated', 'Close', { duration: 2000 });
          this.cancelCategoryEdit();
          this.loadCategories();
        },
        error: () => this.snack.open('Failed to update category', 'Close', { duration: 3000 }),
      });
    } else {
      this.api.post('/config/categories', cat).subscribe({
        next: () => {
          this.snack.open('Category added', 'Close', { duration: 2000 });
          this.cancelCategoryEdit();
          this.loadCategories();
        },
        error: () => this.snack.open('Failed to add category', 'Close', { duration: 3000 }),
      });
    }
  }

  deleteCategory(name: string): void {
    if (!confirm(`Delete category "${name}"?`)) return;
    const encoded = encodeURIComponent(name);
    this.api.delete(`/config/categories/${encoded}`).subscribe({
      next: () => {
        this.loadCategories();
        this.snack.open('Category removed', 'Close', { duration: 2000 });
      },
      error: () => this.snack.open('Failed to delete category', 'Close', { duration: 3000 }),
    });
  }

  ppLabel(level: number): string {
    switch (level) {
      case 0: return 'None';
      case 1: return 'Repair';
      case 2: return 'Unpack';
      case 3: return 'Repair + Unpack';
      default: return 'Unknown';
    }
  }

  // ======================== GENERAL ========================

  loadGeneralSettings(): void {
    this.api.get<{ speed_limit_bps: number }>('/config/speed-limit').subscribe({
      next: r => this.speedLimit = r.speed_limit_bps,
      error: () => {},
    });
    this.api.get<{ max_active_downloads: number }>('/config/max-active-downloads').subscribe({
      next: r => this.maxActiveDownloads = r.max_active_downloads,
      error: () => {},
    });
    this.api.get<{ retention: number | null }>('/config/history-retention').subscribe({
      next: r => this.historyRetention = r.retention,
      error: () => {},
    });
    this.api.get<{ min_free_space_bytes: number; abort_hopeless: boolean }>('/config/disk-guards').subscribe({
      next: r => {
        this.minFreeSpaceGB = r.min_free_space_bytes / (1024 ** 3);
        this.abortHopeless = r.abort_hopeless;
      },
      error: () => {},
    });
  }

  saveDiskGuards(): void {
    this.api.put('/config/disk-guards', {
      min_free_space_bytes: Math.round(this.minFreeSpaceGB * (1024 ** 3)),
      abort_hopeless: this.abortHopeless,
    }).subscribe({
      next: () => this.snack.open('Disk guards saved', 'Close', { duration: 2000 }),
      error: () => this.snack.open('Failed to save disk guards', 'Close', { duration: 3000 }),
    });
  }

  saveSpeedLimit(): void {
    this.api.put('/config/speed-limit', { speed_limit_bps: this.speedLimit }).subscribe({
      next: () => this.snack.open('Speed limit saved', 'Close', { duration: 2000 }),
      error: () => this.snack.open('Failed to save speed limit', 'Close', { duration: 3000 }),
    });
  }

  saveMaxActive(): void {
    this.api.put('/config/max-active-downloads', { max_active_downloads: this.maxActiveDownloads }).subscribe({
      next: () => this.snack.open('Max downloads saved', 'Close', { duration: 2000 }),
      error: () => this.snack.open('Failed to save max downloads', 'Close', { duration: 3000 }),
    });
  }

  saveRetention(): void {
    this.api.put('/config/history-retention', { retention: this.historyRetention }).subscribe({
      next: () => this.snack.open('History retention saved', 'Close', { duration: 2000 }),
      error: () => this.snack.open('Failed to save retention', 'Close', { duration: 3000 }),
    });
  }

  // ======================== DAV CONFIG ========================

  loadDavConfig(): void {
    this.api.get<DavConfig>('/config/dav').subscribe({
      next: cfg => this.davConfig = { ...cfg },
      error: () => {},
    });
  }

  onAutoSendAllChange(): void {
    if (this.davConfig.auto_send_all) {
      this.davConfig.category_rules = [];
    }
  }

  toggleDavCategory(name: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      if (!this.davConfig.category_rules.includes(name)) {
        this.davConfig.category_rules = [...this.davConfig.category_rules, name];
      }
    } else {
      this.davConfig.category_rules = this.davConfig.category_rules.filter(r => r !== name);
    }
  }

  saveDavConfig(): void {
    // Send empty strings as null so the backend treats blanks as "unset".
    const payload: DavConfig = {
      ...this.davConfig,
      username: this.davConfig.username?.trim() || null,
      password: this.davConfig.password?.trim() || null,
      api_key: this.davConfig.api_key?.trim() || null,
    };
    this.api.put('/config/dav', payload).subscribe({
      next: () => this.snack.open('Media Library settings saved', 'Close', { duration: 2000 }),
      error: () => this.snack.open('Failed to save Media Library settings', 'Close', { duration: 3000 }),
    });
  }

  davBaseUrl(): string {
    // Use the browser origin so the URL also works behind a reverse proxy.
    return `${window.location.origin}/dav`;
  }

  davAuthConfigured(): boolean {
    const c = this.davConfig;
    return !!(c.username?.trim() || c.password?.trim() || c.api_key?.trim());
  }

  generateDavApiKey(): void {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    this.davConfig.api_key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    this.showDavApiKey = true;
  }

  copy(text: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.snack.open('Copied', 'Close', { duration: 1500 }),
      () => this.snack.open('Copy failed', 'Close', { duration: 2000 }),
    );
  }
}
