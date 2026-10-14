import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { formatBytes } from '../../core/format';
import { StatusResponse } from '../../core/models/queue.model';
import { ConfirmService } from '../../shared/confirm.service';
import { IconComponent } from '../../shared/icon.component';
import {
  ThemeService,
  THEME_MODES,
  TINT_NAMES,
  type ThemeMode,
  type TintName,
} from '../../core/services/theme.service';
import { showHttpError } from '../../core/http/http-error';

interface ServerConfig {
  id: string; name: string; host: string; port: number; ssl: boolean; ssl_verify: boolean;
  username: string | null; password: string | null; connections: number; priority: number;
  enabled: boolean; retention: number; pipelining: number; optional: boolean; compress: boolean;
  ramp_up_delay_ms: number; proxy_url: string | null; connect_timeout_secs: number;
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
  enabled: boolean;
  auto_send_all: boolean;
  category_rules: string[];
  username: string | null;
  password: string | null;
  api_key: string | null;
}

interface GeneralDirs {
  data_dir: string;
  incomplete_dir: string;
  complete_dir: string;
  watch_dir: string | null;
}

/** The subset of `general` from GET /api/config that this page edits or shows. */
interface GeneralConfig extends GeneralDirs {
  cache_size?: number;
  max_post_processing_jobs?: number;
  max_repair_workers?: number;
  max_extract_workers?: number;
  rss_history_limit?: number | null;
  rss_downloaded_item_expiry_days?: number | null;
  direct_unpack?: boolean;
  max_nested_archive_depth?: number;
  early_failure_check?: boolean;
  required_completion_pct?: number;
  article_timeout_secs?: number;
  auto_sort_remaining_pct?: boolean;
  scripts_dir?: string | null;
  script_success?: string | null;
  script_failure?: string | null;
  script_timeout_secs?: number;
  script_max_output_bytes?: number;
  fetch_allow_private?: boolean;
  fetch_allowed_hosts?: string[];
}

interface SabApiKeyResponse {
  api_key: string | null;
}

/** Placeholder the backend treats as "keep the stored password". */
const PASSWORD_MASK = '********';

const MODE_LABELS: Record<ThemeMode, string> = {
  auto: 'Automatic',
  light: 'Light',
  dark: 'Dark',
  oled: 'OLED (Pure Black)',
};

function emptyServer(): ServerConfig {
  return {
    id: '', name: '', host: '', port: 563, ssl: true, ssl_verify: true,
    username: null, password: null, connections: 8, priority: 0,
    enabled: true, retention: 0, pipelining: 4, optional: false, compress: false,
    ramp_up_delay_ms: 50, proxy_url: null, connect_timeout_secs: 30,
  };
}

function emptyCategory(): CategoryConfig {
  return { name: '', output_dir: null, post_processing: 3 };
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

@Component({
  selector: 'app-settings-view',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatSnackBarModule, IconComponent],
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
        @if (webdavAvailable()) {
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
            @if (webdavAvailable()) { <option value="dav">Media Library (DAV)</option> }
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
                <div class="drag"><app-icon name="drag-handle" [size]="14" /></div>
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
                    <span>timeout <b>{{ s.connect_timeout_secs }} s</b></span>
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
                  <button class="btn sm" [class.active]="expandedStatsId === s.id"
                          [attr.aria-expanded]="expandedStatsId === s.id" (click)="toggleStats(s.id)">Stats</button>
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
                        <div class="srv-stats-row"><span>24 hours</span><b>{{ fmtBytes(st.today_bytes) }}</b></div>
                        <div class="srv-stats-row"><span>7 days</span><b>{{ fmtBytes(st.week_bytes) }}</b></div>
                        <div class="srv-stats-row"><span>30 days</span><b>{{ fmtBytes(st.month_bytes) }}</b></div>
                      </div>
                      <div class="srv-stats-col">
                        <div class="srv-stats-heading">Article availability</div>
                        <div class="srv-stats-row"><span>Total</span><b>{{ fmtAvail(st.total_ok, st.total_fail) }}</b></div>
                        <div class="srv-stats-row"><span>24 hours</span><b>{{ fmtAvail(st.today_ok, st.today_fail) }}</b></div>
                        <div class="srv-stats-row"><span>7 days</span><b>{{ fmtAvail(st.week_ok, st.week_fail) }}</b></div>
                        <div class="srv-stats-row"><span>30 days</span><b>{{ fmtAvail(st.month_ok, st.month_fail) }}</b></div>
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
                  <label for="srvName">Name</label>
                  <input id="srvName" type="text" [(ngModel)]="editingServer.name" placeholder="news-primary" />

                  <label for="srvHost">Host</label>
                  <input id="srvHost" type="text" [(ngModel)]="editingServer.host" placeholder="news.example.com" />

                  <label for="srvPort">Port</label>
                  <div class="inline">
                    <input id="srvPort" type="number" [(ngModel)]="editingServer.port" min="1" max="65535" />
                    <label class="check"><input type="checkbox" [(ngModel)]="editingServer.ssl" /> SSL (NNTPS)</label>
                    <label class="check"><input type="checkbox" [(ngModel)]="editingServer.ssl_verify" /> Verify cert</label>
                  </div>

                  <label for="srvUser">Username</label>
                  <input id="srvUser" type="text" [(ngModel)]="editingServer.username" placeholder="(optional)" autocomplete="off" />

                  <label for="srvPass">Password</label>
                  <input id="srvPass" type="password" [(ngModel)]="editingServer.password" autocomplete="new-password"
                         [placeholder]="editingServerId ? '(unchanged — type to replace)' : '(optional)'" />

                  <label for="srvConns">Connections</label>
                  <div class="inline">
                    <input id="srvConns" type="number" [(ngModel)]="editingServer.connections" min="1" />
                    <label class="check"><input type="checkbox" [(ngModel)]="editingServer.enabled" /> Enabled</label>
                    <label class="check"><input type="checkbox" [(ngModel)]="editingServer.optional" /> Optional (skip on failure)</label>
                  </div>

                  <label for="srvPrio">Priority</label>
                  <div class="inline">
                    <input id="srvPrio" type="number" [(ngModel)]="editingServer.priority" min="0" />
                    <span style="color:var(--mute);font-size:11px">0 = primary, higher = fallback</span>
                  </div>

                  <label for="srvPipe">Pipelining</label>
                  <div class="inline">
                    <input id="srvPipe" type="number" [(ngModel)]="editingServer.pipelining" min="0" />
                    <span style="color:var(--mute);font-size:11px">Max inflight ARTICLE commands per conn</span>
                  </div>

                  <label for="srvRamp">Ramp-up delay</label>
                  <div class="inline">
                    <input id="srvRamp" type="number" [(ngModel)]="editingServer.ramp_up_delay_ms" min="0" />
                    <span style="color:var(--mute);font-size:11px">ms between opening conns</span>
                  </div>

                  <label for="srvTimeout">Connection timeout</label>
                  <div class="inline">
                    <input id="srvTimeout" type="number" [(ngModel)]="editingServer.connect_timeout_secs" min="1" />
                    <span style="color:var(--mute);font-size:11px">seconds to wait before treating this server as unreachable</span>
                  </div>

                  <label for="srvRet">Retention</label>
                  <div class="inline">
                    <input id="srvRet" type="number" [(ngModel)]="editingServer.retention" min="0" />
                    <span style="color:var(--mute);font-size:11px">days (informational)</span>
                  </div>

                  <label>Compression</label>
                  <label class="check">
                    <input type="checkbox" [(ngModel)]="editingServer.compress" /> Enable header compression (XZVER)
                  </label>

                  <label for="srvProxy">Proxy URL</label>
                  <input id="srvProxy" type="text" [(ngModel)]="editingServer.proxy_url" placeholder="socks5://user:pass@host:1080 (optional)" />
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
            <h3>Item history</h3>
            <div class="body">
              <div class="form">
                <label for="rssLimit">Keep feed items</label>
                <input id="rssLimit" type="number" [(ngModel)]="rssHistoryLimit" min="1" placeholder="keep all" />
                <div class="help">Newest items kept across all feeds; older ones are pruned immediately on save.</div>

                <label for="rssExpiry">Expire downloaded</label>
                <input id="rssExpiry" type="number" [(ngModel)]="rssExpiryDays" min="1" placeholder="never" />
                <div class="help">Days after which items that were already downloaded are removed.</div>
              </div>
              <div class="form-actions">
                <button class="btn primary" (click)="saveRssSettings()">Save</button>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>Server-side fetch policy <span class="hint">read-only · config.toml</span></h3>
            <div class="body">
              <div class="form">
                <label>Private addresses</label>
                <div>
                  <span class="pill" [class.ok]="!fetchAllowPrivate" [class.warn]="fetchAllowPrivate">
                    ● {{ fetchAllowPrivate ? 'allowed' : 'blocked' }}
                  </span>
                </div>
                <div class="help">
                  Whether feed, add-URL and SABnzbd <code>addurl</code> fetches may reach LAN addresses
                  (RFC 1918, CGNAT, IPv6 ULA). Set <code>fetch_allow_private</code> under <code>[general]</code>.
                </div>

                <label>Allowed hosts</label>
                <div class="host-chips">
                  @for (h of fetchAllowedHosts; track h) {
                    <code>{{ h }}</code>
                  } @empty {
                    <span class="dim">None</span>
                  }
                </div>
                <div class="help">
                  IPs, CIDR blocks or exact host names that are always reachable, e.g. <code>prowlarr</code>.
                  Set <code>fetch_allowed_hosts</code> under <code>[general]</code>; restart to apply.
                </div>
              </div>
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
                    <th style="width:120px"><span class="visually-hidden">Actions</span></th>
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
                  <label for="catName">Name</label>
                  <input id="catName" type="text" [(ngModel)]="editingCategory.name" placeholder="movies" />

                  <label for="catDir">Output dir</label>
                  <input id="catDir" type="text" [(ngModel)]="editingCategory.output_dir" placeholder="(optional — uses default if blank)" />

                  <label for="catPp">Post-processing</label>
                  <select id="catPp" [(ngModel)]="editingCategory.post_processing">
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

        <!-- =========== POST-PROCESSING =========== -->
        @if (tab === 'postproc') {
          <div class="section-head">
            <div>
              <h2>Post-processing</h2>
              <div class="sub">Par2 repair (native Rust), unrar / 7z extraction, scripts, cleanup.</div>
            </div>
          </div>

          <div class="panel">
            <h3>Workers <span class="hint">restart to apply</span></h3>
            <div class="body">
              <div class="form">
                <label for="ppJobs">Parallel jobs</label>
                <input id="ppJobs" type="number" [(ngModel)]="maxPostProcessingJobs" min="1" max="64" />
                <div class="help">Independent jobs that may be post-processed at the same time (1–64).</div>

                <label for="ppRepair">Repair workers</label>
                <input id="ppRepair" type="number" [(ngModel)]="maxRepairWorkers" min="1" max="64" />
                <div class="help">Concurrent PAR2 verify / repair tasks.</div>

                <label for="ppExtract">Extract workers</label>
                <input id="ppExtract" type="number" [(ngModel)]="maxExtractWorkers" min="1" max="64" />
                <div class="help">Concurrent archive extraction tasks.</div>
              </div>
              <div class="form-actions">
                <button class="btn primary" (click)="savePostprocWorkers()">Save</button>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>Extraction <span class="hint">restart to apply</span></h3>
            <div class="body">
              <div class="form">
                <label>Direct unpack</label>
                <label class="toggle">
                  <input type="checkbox" [(ngModel)]="directUnpack" />
                  <span>Extract RAR volumes while the download is still running</span>
                </label>
                <div class="help">Needs <code>unrar</code>; falls back to normal post-processing if articles fail.</div>

                <label for="ppDepth">Nested archives</label>
                <input id="ppDepth" type="number" [(ngModel)]="maxNestedArchiveDepth" min="0" max="10" />
                <div class="help">Archive layers extracted after the outer one (0–10; 0 = outer archive only).</div>
              </div>
              <div class="form-actions">
                <button class="btn primary" (click)="saveExtraction()">Save</button>
              </div>
              <div class="dim" style="margin-top:12px">
                System <code>unrar</code> and <code>7z</code> are detected at startup.
                Run <code>--smoke-test</code> to verify the runtime tools.
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>Scripts</h3>
            <div class="body">
              <div class="form">
                <label for="scDir">Scripts dir</label>
                <input id="scDir" type="text" [(ngModel)]="scriptsDir" placeholder="(not set)" />
                <div class="help">Optional directory the script paths below are resolved against.</div>

                <label for="scOk">On success</label>
                <input id="scOk" type="text" [(ngModel)]="scriptSuccess" placeholder="(none)" />

                <label for="scFail">On failure</label>
                <input id="scFail" type="text" [(ngModel)]="scriptFailure" placeholder="(none)" />
                <div class="help">Run after a job finishes post-processing. Leave blank to disable.</div>

                <label for="scTimeout">Timeout</label>
                <div class="inline">
                  <input id="scTimeout" type="number" [(ngModel)]="scriptTimeoutSecs" min="1" />
                  <span style="color:var(--mute);font-size:11px">seconds before the script is stopped</span>
                </div>

                <label for="scOut">Max output</label>
                <div class="inline">
                  <input id="scOut" type="number" [(ngModel)]="scriptMaxOutputKiB" min="0" />
                  <span style="color:var(--mute);font-size:11px">KiB of captured output kept</span>
                </div>
              </div>
              <div class="form-actions">
                <button class="btn primary" (click)="saveScripts()">Save</button>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>Par2 repair <span class="hint">rust-par2 · no external binary</span></h3>
            <div class="body" style="font-size:13px;color:var(--mute)">
              Whether a job is repaired and/or unpacked is set per category (see
              <a (click)="tab = 'categories'" style="cursor:pointer">Categories</a>).
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

        <!-- =========== PATHS & DISK =========== -->
        @if (tab === 'paths') {
          <div class="section-head">
            <div>
              <h2>Paths &amp; disk</h2>
              <div class="sub">Where rustnzb reads and writes. Set via CLI / TOML / env.</div>
            </div>
          </div>

          <div class="panel">
            <h3>Directories</h3>
            <div class="body dir-table">
              <div class="dir-row">
                <span class="dir-label">Data dir</span>
                <code class="dir-val">{{ dirs()?.data_dir ?? '…' }}</code>
                <span class="dir-hint">SQLite, queue state, job blobs · set via <code>RUSTNZB_DATA_DIR</code> or <code>--data-dir</code></span>
              </div>
              <div class="dir-row">
                <span class="dir-label">Downloads</span>
                <code class="dir-val">{{ dirs()?.complete_dir ?? '…' }}</code>
                <span class="dir-hint">configured per category</span>
              </div>
              <div class="dir-row">
                <span class="dir-label">Incomplete</span>
                <code class="dir-val">{{ dirs()?.incomplete_dir ?? '…' }}</code>
                <span class="dir-hint">in-progress download working area</span>
              </div>
              <div class="dir-row">
                <span class="dir-label">Watch dir</span>
                @if (dirs()?.watch_dir) {
                  <code class="dir-val">{{ dirs()!.watch_dir }}</code>
                  <span class="dir-hint"><code>.nzb</code> drops auto-enqueue</span>
                } @else {
                  <span class="dir-val dim">— not configured</span>
                  <span class="dir-hint">set <code>watch_dir</code> in config to enable</span>
                }
              </div>
              <div class="dir-row">
                <span class="dir-label">Temp</span>
                <code class="dir-val">{{ dirs() ? dirs()!.data_dir + '/tmp' : '…' }}</code>
                <span class="dir-hint">transient working files</span>
              </div>
              <div class="dir-row">
                <span class="dir-label">Logs</span>
                <code class="dir-val">{{ dirs() ? dirs()!.data_dir + '/logs' : '…' }}</code>
                <span class="dir-hint">per-job log files</span>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>Disk guards
              <span class="hint">history retention is editable under <a (click)="tab = 'general'" style="cursor:pointer">General</a></span>
            </h3>
            <div class="body">
              <div class="form">
                <label for="minFree">Min free space</label>
                <div class="inline">
                  <input id="minFree" type="number" [(ngModel)]="minFreeSpaceGB" min="0" step="0.1" />
                  <span style="color:var(--mute)">GB · 0 = disabled · restart to apply</span>
                  <button class="btn sm" (click)="saveDiskGuards()">Save</button>
                </div>
                <label>Abort hopeless</label>
                <label class="toggle">
                  <input type="checkbox" [(ngModel)]="abortHopeless" (change)="saveDiskGuards()" />
                  <span>Abort downloads that cannot possibly complete</span>
                </label>
                <div class="help">Fine-tune the failure checks under <a (click)="tab = 'general'" style="cursor:pointer">General</a>.</div>
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
            <h3>Runtime</h3>
            <div class="body">
              <div class="form">
                <label>Enable Media Library</label>
                <label class="toggle">
                  <input type="checkbox" [(ngModel)]="davConfig.enabled" />
                  <span>Mount <code>/dav</code> and show the Media page</span>
                </label>
                <div class="help">
                  Changing this flag requires a rustnzb restart. Docker deployments can also enable
                  it with <code>RUSTNZB_DAV_ENABLED=1</code>.
                </div>
              </div>

              @if (davRestartRequired()) {
                <div class="dav-warn" style="margin-top:14px" role="status">
                  Restart required: the saved DAV setting does not match the running service yet.
                </div>
              }

              <div class="form-actions">
                <button class="btn primary" (click)="saveDavConfig()">Save</button>
              </div>
            </div>
          </div>

          @if (davConfig.enabled) {
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
                  <label for="davUser">DAV username</label>
                  <input id="davUser" type="text" [(ngModel)]="davConfig.username" placeholder="e.g. plex" autocomplete="off" />

                  <label for="davPass">DAV password</label>
                  <div class="inline">
                    <input id="davPass" class="wide" [type]="showDavPassword ? 'text' : 'password'" [(ngModel)]="davConfig.password" autocomplete="new-password" />
                    <button class="btn sm" (click)="showDavPassword = !showDavPassword" type="button">
                      {{ showDavPassword ? 'Hide' : 'Show' }}
                    </button>
                  </div>

                  <label for="davKey">DAV API key</label>
                  <div class="inline">
                    <input id="davKey" class="wide" [type]="showDavApiKey ? 'text' : 'password'" [(ngModel)]="davConfig.api_key" autocomplete="off"
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
                  <label class="toggle">
                    <input type="checkbox" [(ngModel)]="davConfig.auto_send_all" (change)="onAutoSendAllChange()" />
                    <span>Automatically queue every completed download into the Media Library</span>
                  </label>

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
          } @else {
            <div class="panel">
              <div class="body">
                <div class="dim">
                  DAV access, Media navigation, and automatic media-library ingest stay disabled
                  until the runtime flag above is enabled and the service is restarted.
                </div>
              </div>
            </div>
          }
        }

        <!-- =========== GENERAL =========== -->
        @if (tab === 'general') {
          <div class="section-head">
            <div>
              <h2>General</h2>
              <div class="sub">Speed limit, concurrency, queue order, history and failure checks.</div>
            </div>
          </div>

          <div class="panel">
            <h3>Speed &amp; concurrency</h3>
            <div class="body">
              <div class="form">
                <label for="genSpeed">Global speed limit</label>
                <div class="inline">
                  <input id="genSpeed" type="number" [(ngModel)]="speedLimit" min="0" />
                  <span style="color:var(--mute)">bytes/sec · 0 = unlimited</span>
                  <button class="btn sm" (click)="saveSpeedLimit()">Save</button>
                </div>

                <label for="genActive">Concurrent jobs</label>
                <div class="inline">
                  <input id="genActive" type="number" [(ngModel)]="maxActiveDownloads" min="0" max="100" />
                  <span style="color:var(--mute);font-size:11px">Max jobs in Downloading state · 0 = unlimited</span>
                  <button class="btn sm" (click)="saveMaxActive()">Save</button>
                </div>

                <label for="genRet">History retention</label>
                <div class="inline">
                  <input id="genRet" type="number" [(ngModel)]="historyRetention" min="0" />
                  <span style="color:var(--mute)">jobs kept · blank = keep all</span>
                  <button class="btn sm" (click)="saveRetention()">Save</button>
                </div>

                <label for="genCache">Article cache</label>
                <div class="inline">
                  <input id="genCache" type="number" [(ngModel)]="cacheSizeMB" min="16" max="65536" />
                  <span style="color:var(--mute);font-size:11px">MB · 16–65536 · restart to apply</span>
                  <button class="btn sm" (click)="saveCacheSize()">Save</button>
                </div>

                <label>Queue order</label>
                <label class="toggle">
                  <input type="checkbox" [(ngModel)]="autoSortRemainingPct" (change)="saveAutoSort()" />
                  <span>Sort queued jobs by remaining percentage as they progress</span>
                </label>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>Failure detection <span class="hint">restart to apply</span></h3>
            <div class="body">
              <div class="form">
                <label>Early check</label>
                <label class="toggle">
                  <input type="checkbox" [(ngModel)]="earlyFailureCheck" />
                  <span>Abort dead NZBs within the first articles (&gt;80% missing)</span>
                </label>
                <div class="help">
                  Requires <a (click)="tab = 'paths'" style="cursor:pointer">Abort hopeless</a>
                  ({{ abortHopeless ? 'on' : 'off' }}).
                </div>

                <label for="genPct">Required completion</label>
                <div class="inline">
                  <input id="genPct" type="number" [(ngModel)]="requiredCompletionPct" min="100" max="200" step="0.1" />
                  <span style="color:var(--mute);font-size:11px">% · 100–200, includes PAR2 recovery capacity</span>
                </div>

                <label for="genArt">Article timeout</label>
                <div class="inline">
                  <input id="genArt" type="number" [(ngModel)]="articleTimeoutSecs" min="0" max="3600" />
                  <span style="color:var(--mute);font-size:11px">seconds before a stalled connection reconnects · 0 = none</span>
                </div>
              </div>
              <div class="form-actions">
                <button class="btn primary" (click)="saveFailureDetection()">Save</button>
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
              <code class="break">{{ sabnzbdExample }}</code>
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
            <h3>SABnzbd API key</h3>
            <div class="body">
              <p class="dim" style="margin-top:0">
                This key grants access to the SABnzbd-compatible endpoint. Reveal it only when
                configuring an integration; rotating it immediately invalidates the previous key.
              </p>
              <div class="key-row">
                <input
                  class="key-input"
                  aria-label="SABnzbd API key"
                  [type]="showSabApiKey ? 'text' : 'password'"
                  [value]="sabApiKey || ''"
                  readonly
                  autocomplete="off"
                  placeholder="No SABnzbd API key configured"
                />
                <div class="key-actions">
                  <button class="btn sm" (click)="showSabApiKey = !showSabApiKey" type="button">
                    {{ showSabApiKey ? 'Hide' : 'Reveal' }}
                  </button>
                  <button class="btn sm" [disabled]="!sabApiKey" (click)="copy(sabApiKey!)" type="button">Copy</button>
                  <button class="btn sm danger" (click)="rotateSabApiKey()" type="button">
                    {{ sabApiKey ? 'Rotate' : 'Generate' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>OpenAPI / Swagger</h3>
            <div class="body">
              <a href="/swagger-ui" target="_blank" rel="noopener">Open <code>/swagger-ui</code></a>
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
                <label for="colorScheme">Color scheme</label>
                <select
                  id="colorScheme"
                  [ngModel]="theme.mode()"
                  (ngModelChange)="theme.setMode($event)"
                >
                  @for (m of themeModes; track m) {
                    <option [value]="m">{{ modeLabels[m] }}</option>
                  }
                </select>
                <div class="help">Automatic follows the system (Light/Dark). OLED uses true black for AMOLED displays.</div>

                <label id="accentLabel">Accent</label>
                <div class="tint-grid" role="group" aria-labelledby="accentLabel">
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
                <label>Version</label><div class="tabular-nums">{{ status()?.version || '—' }}</div>
                <label>Rust edition</label><div>2024</div>
                <label>Web framework</label><div>Axum 0.8 + Tower</div>
                <label>TLS</label><div>rustls 0.23 (ring)</div>
                <label>Database</label><div>SQLite · WAL mode · bundled</div>
                <label>License</label><div>MIT</div>
                <label>Source</label>
                <div>
                  <a href="https://github.com/TheDancingDeveloper-org/rustnzb" target="_blank" rel="noopener"
                    >github.com/TheDancingDeveloper-org/rustnzb</a>
                </div>
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

    /* Long sidebars stay reachable on short viewports. */
    .settings-side {
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      box-sizing: border-box;
    }
    .settings-shell { align-items: start; }

    .toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      cursor: pointer;
    }
    .toggle input { flex-shrink: 0; }

    .dir-label { font-weight: 600; white-space: nowrap; }
    .dir-val { grid-column: 2; font-size: 12px; word-break: break-all; }
    .dir-hint { grid-column: 2; color: var(--mute); font-size: 11px; margin-top: -2px; }

    .form .inline input.wide { max-width: none; flex: 1 1 200px; }

    .key-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .key-input {
      flex: 1 1 260px;
      min-width: 0;
      min-height: 44px;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--panel2);
      color: var(--text);
      font: 12px ui-monospace, Menlo, monospace;
    }
    .key-input:focus { outline: none; border-color: var(--tint); }
    .key-actions { display: flex; gap: 6px; flex-wrap: wrap; }

    .host-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .host-chips code {
      background: var(--panel2);
      border: 1px solid var(--line);
      border-radius: var(--radius-pill);
      padding: 2px 10px;
      font-size: 12px;
    }
    code.break { word-break: break-all; }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    @media (max-width: 1023px) {
      .settings-side { max-height: none; }
      .dir-val, .dir-hint { grid-column: auto; }
      .form-actions { flex-wrap: wrap; }
      .key-actions { width: 100%; }
    }
  `],
})
export class SettingsViewComponent implements OnInit, OnDestroy {
  private _tab: Tab = 'servers';

  /** Current section. The live theme preview only animates while Display is open. */
  get tab(): Tab {
    return this._tab;
  }
  set tab(value: Tab) {
    this._tab = value;
    if (value === 'display') this.startPreview();
    else this.stopPreview();
  }

  /** Drives the animated “live” speed readout in the theme preview. */
  private readonly previewTick = signal(0);
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  /** Fake MB/s for display preview (updates a few times per second). */
  readonly previewSpeedText = computed(() => {
    const t = this.previewTick();
    const mbps = 8.5 + 4.2 * Math.sin(t * 0.35) + 1.1 * Math.sin(t * 0.91);
    return mbps.toFixed(1) + ' MB/s';
  });

  readonly themeModes = THEME_MODES;
  readonly modeLabels = MODE_LABELS;
  readonly tintNames: readonly TintName[] = TINT_NAMES;

  readonly sabnzbdExample = `${typeof location !== 'undefined' ? location.origin : 'http://host:9090'}/sabnzbd/api?apikey=...&mode=queue`;

  onTabSelect(v: string): void {
    let t = v as Tab;
    if (t === 'dav' && !this.webdavAvailable()) t = 'servers';
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
  cacheSizeMB = 500;
  autoSortRemainingPct = false;

  // Failure detection (read at engine start)
  earlyFailureCheck = true;
  requiredCompletionPct = 100.2;
  articleTimeoutSecs = 30;

  // Disk guards
  minFreeSpaceGB = 1;
  abortHopeless = true;

  // Post-processing (workers and extraction are read at engine start)
  maxPostProcessingJobs = 2;
  maxRepairWorkers = 1;
  maxExtractWorkers = 1;
  directUnpack = true;
  maxNestedArchiveDepth = 5;
  scriptsDir = '';
  scriptSuccess = '';
  scriptFailure = '';
  scriptTimeoutSecs = 300;
  scriptMaxOutputKiB = 64;

  // RSS
  rssHistoryLimit: number | null = 500;
  rssExpiryDays: number | null = null;
  fetchAllowPrivate = false;
  fetchAllowedHosts: string[] = [];

  // Status / feature flags
  status = signal<StatusResponse | null>(null);
  webdavAvailable = computed(() => this.status()?.webdav_available ?? false);
  davRuntimeEnabled = computed(() => this.status()?.webdav_enabled ?? false);

  // DAV config
  davConfig: DavConfig = {
    enabled: false, auto_send_all: false, category_rules: [], username: null, password: null, api_key: null,
  };
  showDavPassword = false;
  showDavApiKey = false;
  sabApiKey: string | null = null;
  showSabApiKey = false;

  // Directory paths (from /api/config)
  dirs = signal<GeneralDirs | null>(null);

  constructor(
    private api: ApiService,
    private snack: MatSnackBar,
    private confirmSvc: ConfirmService,
    public readonly theme: ThemeService,
  ) {}

  ngOnInit(): void {
    this.loadServers();
    this.loadCategories();
    this.loadGeneralSettings();
    this.loadSabApiKey();
    this.loadStatus();
    this.loadDirs();
  }

  ngOnDestroy(): void {
    this.stopPreview();
  }

  private startPreview(): void {
    if (this.previewTimer) return;
    this.previewTimer = setInterval(() => this.previewTick.update(n => n + 1), 500);
  }

  private stopPreview(): void {
    if (this.previewTimer) {
      clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
  }

  loadStatus(): void {
    this.api.get<StatusResponse>('/status').subscribe({
      next: s => {
        this.status.set(s);
        if (s.webdav_available) this.loadDavConfig();
      },
      error: () => {},
    });
  }

  /** Directory paths plus the `[general]` values edited on this page. */
  loadDirs(): void {
    this.api.get<{ general: GeneralConfig }>('/config').subscribe({
      next: cfg => this.applyGeneralConfig(cfg.general),
      error: () => {},
    });
  }

  private applyGeneralConfig(g: GeneralConfig): void {
    this.dirs.set({
      data_dir: g.data_dir,
      incomplete_dir: g.incomplete_dir,
      complete_dir: g.complete_dir,
      watch_dir: g.watch_dir ?? null,
    });
    if (isInt(g.cache_size)) this.cacheSizeMB = Math.round(g.cache_size / 1024 ** 2);
    if (typeof g.auto_sort_remaining_pct === 'boolean') this.autoSortRemainingPct = g.auto_sort_remaining_pct;
    if (typeof g.early_failure_check === 'boolean') this.earlyFailureCheck = g.early_failure_check;
    if (typeof g.required_completion_pct === 'number') this.requiredCompletionPct = g.required_completion_pct;
    if (isInt(g.article_timeout_secs)) this.articleTimeoutSecs = g.article_timeout_secs;
    if (isInt(g.max_post_processing_jobs)) this.maxPostProcessingJobs = g.max_post_processing_jobs;
    if (isInt(g.max_repair_workers)) this.maxRepairWorkers = g.max_repair_workers;
    if (isInt(g.max_extract_workers)) this.maxExtractWorkers = g.max_extract_workers;
    if (typeof g.direct_unpack === 'boolean') this.directUnpack = g.direct_unpack;
    if (isInt(g.max_nested_archive_depth)) this.maxNestedArchiveDepth = g.max_nested_archive_depth;
    if ('scripts_dir' in g) this.scriptsDir = g.scripts_dir ?? '';
    if ('script_success' in g) this.scriptSuccess = g.script_success ?? '';
    if ('script_failure' in g) this.scriptFailure = g.script_failure ?? '';
    if (isInt(g.script_timeout_secs)) this.scriptTimeoutSecs = g.script_timeout_secs;
    if (isInt(g.script_max_output_bytes)) this.scriptMaxOutputKiB = Math.round(g.script_max_output_bytes / 1024);
    if ('rss_history_limit' in g) this.rssHistoryLimit = g.rss_history_limit ?? null;
    if ('rss_downloaded_item_expiry_days' in g) this.rssExpiryDays = g.rss_downloaded_item_expiry_days ?? null;
    if (typeof g.fetch_allow_private === 'boolean') this.fetchAllowPrivate = g.fetch_allow_private;
    if (Array.isArray(g.fetch_allowed_hosts)) this.fetchAllowedHosts = g.fetch_allowed_hosts;
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
    return formatBytes(bytes);
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

  // The API masks stored passwords; the form starts blank and a blank
  // password on save means "keep the stored one".
  editServer(s: ServerConfig): void {
    this.editingServer = { ...s, password: '' };
    this.editingServerId = s.id;
  }

  cloneServer(s: ServerConfig): void {
    this.editingServer = { ...s, id: '', name: `${s.name} (copy)`, password: '' };
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
    if (this.editingServerId) {
      server.password = server.password ? server.password : PASSWORD_MASK;
    } else if (!server.password) {
      server.password = null;
    }

    if (this.editingServerId) {
      this.api.put(`/config/servers/${this.editingServerId}`, server).subscribe({
        next: () => {
          this.snack.open('Server updated', 'Close', { duration: 2000 });
          this.cancelServerEdit();
          this.loadServers();
        },
        error: err => showHttpError(this.snack, err, 'Failed to update server'),
      });
    } else {
      server.id = '';
      this.api.post('/config/servers', server).subscribe({
        next: () => {
          this.snack.open('Server added', 'Close', { duration: 2000 });
          this.cancelServerEdit();
          this.loadServers();
        },
        error: err => showHttpError(this.snack, err, 'Failed to add server'),
      });
    }
  }

  testServer(id: string): void {
    this.api.post<{ success: boolean; message: string }>(`/config/servers/${id}/test`).subscribe({
      next: r => this.snack.open(r.message, 'Close', { duration: 3000 }),
      error: err => showHttpError(this.snack, err, 'Test failed'),
    });
  }

  // Test the current (possibly unsaved) form values against the NNTP server.
  // Uses the inline test endpoint so users don't have to Save before verifying edits.
  testEditingServer(): void {
    if (!this.editingServer) return;
    const body = { ...this.editingServer };
    if (!body.username) body.username = null;
    if (this.editingServerId && !body.password) body.password = PASSWORD_MASK;
    else if (!body.password) body.password = null;
    this.snack.open('Testing…', '', { duration: 1500 });
    this.api.post<{ success: boolean; message: string }>(`/config/servers/test-config`, body).subscribe({
      next: r => this.snack.open(r.message, 'Close', { duration: 4000 }),
      error: err => showHttpError(this.snack, err, 'Test failed'),
    });
  }

  toggleServerEnabled(s: ServerConfig): void {
    const updated = { ...s, enabled: !s.enabled };
    if (!updated.username) updated.username = null;
    if (!updated.password) updated.password = PASSWORD_MASK;
    this.api.put(`/config/servers/${s.id}`, updated).subscribe({
      next: () => {
        this.loadServers();
        this.snack.open(updated.enabled ? 'Server enabled' : 'Server disabled', 'Close', { duration: 2000 });
      },
      error: err => showHttpError(this.snack, err, 'Failed to update server'),
    });
  }

  deleteServer(id: string): void {
    this.confirmSvc
      .confirm({
        title: 'Remove this server?',
        message: 'Downloads in progress on this server may be interrupted.',
        confirmLabel: 'Remove',
        danger: true,
      })
      .subscribe(ok => {
        if (!ok) return;
        this.api.delete(`/config/servers/${id}`).subscribe({
          next: () => {
            this.loadServers();
            this.snack.open('Server removed', 'Close', { duration: 2000 });
          },
          error: err => showHttpError(this.snack, err, 'Failed to delete server'),
        });
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
        error: err => showHttpError(this.snack, err, 'Failed to update category'),
      });
    } else {
      this.api.post('/config/categories', cat).subscribe({
        next: () => {
          this.snack.open('Category added', 'Close', { duration: 2000 });
          this.cancelCategoryEdit();
          this.loadCategories();
        },
        error: err => showHttpError(this.snack, err, 'Failed to add category'),
      });
    }
  }

  deleteCategory(name: string): void {
    this.confirmSvc
      .confirm({
        title: `Delete category "${name}"?`,
        message: 'Jobs already assigned to this category keep their setting; new jobs can no longer use it.',
        confirmLabel: 'Delete',
        danger: true,
      })
      .subscribe(ok => {
        if (!ok) return;
        const encoded = encodeURIComponent(name);
        this.api.delete(`/config/categories/${encoded}`).subscribe({
          next: () => {
            this.loadCategories();
            this.snack.open('Category removed', 'Close', { duration: 2000 });
          },
          error: err => showHttpError(this.snack, err, 'Failed to delete category'),
        });
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

  loadSabApiKey(): void {
    this.api.get<SabApiKeyResponse>('/config/sabnzbd-api-key').subscribe({
      next: response => (this.sabApiKey = response.api_key),
      error: err => showHttpError(this.snack, err, 'Failed to load SABnzbd API key'),
    });
  }

  rotateSabApiKey(): void {
    const action = this.sabApiKey ? 'Rotate' : 'Generate';
    this.confirmSvc
      .confirm({
        title: `${action} SABnzbd API key?`,
        message: this.sabApiKey
          ? 'The current key will stop working immediately. Update Sonarr, Radarr, Lidarr, and any other integrations with the new key.'
          : 'This creates the credential used by Sonarr, Radarr, Lidarr, and other SABnzbd-compatible clients.',
        confirmLabel: `${action} key`,
        danger: !!this.sabApiKey,
      })
      .subscribe(ok => {
        if (!ok) return;
        this.api.post<SabApiKeyResponse>('/config/sabnzbd-api-key/rotate', {}).subscribe({
          next: response => {
            this.sabApiKey = response.api_key;
            this.showSabApiKey = true;
            this.snack.open(`SABnzbd API key ${action.toLowerCase()}d`, 'Close', { duration: 2500 });
          },
          error: err => showHttpError(this.snack, err, `Failed to ${action.toLowerCase()} SABnzbd API key`),
        });
      });
  }

  saveDiskGuards(): void {
    this.api.put('/config/disk-guards', {
      min_free_space_bytes: Math.round(this.minFreeSpaceGB * (1024 ** 3)),
      abort_hopeless: this.abortHopeless,
    }).subscribe({
      next: () => this.snack.open('Disk guards saved', 'Close', { duration: 2000 }),
      error: err => showHttpError(this.snack, err, 'Failed to save disk guards'),
    });
  }

  saveSpeedLimit(): void {
    this.api.put('/config/speed-limit', { speed_limit_bps: this.speedLimit }).subscribe({
      next: () => this.snack.open('Speed limit saved', 'Close', { duration: 2000 }),
      error: err => showHttpError(this.snack, err, 'Failed to save speed limit'),
    });
  }

  saveMaxActive(): void {
    this.api.put('/config/max-active-downloads', { max_active_downloads: this.maxActiveDownloads }).subscribe({
      next: () => this.snack.open('Max downloads saved', 'Close', { duration: 2000 }),
      error: err => showHttpError(this.snack, err, 'Failed to save max downloads'),
    });
  }

  saveRetention(): void {
    this.api.put('/config/history-retention', { retention: this.historyRetention }).subscribe({
      next: () => this.snack.open('History retention saved', 'Close', { duration: 2000 }),
      error: err => showHttpError(this.snack, err, 'Failed to save retention'),
    });
  }

  // ---- PUT /config/general (partial updates; the endpoint rejects unknown fields) ----

  /** Snack-reports an out-of-range integer and returns false. */
  private checkInt(value: unknown, min: number, max: number, label: string): value is number {
    if (isInt(value) && value >= min && value <= max) return true;
    this.snack.open(`${label} must be a whole number between ${min} and ${max}`, 'Close', { duration: 3000 });
    return false;
  }

  private putGeneral(body: Record<string, unknown>, okMessage: string, failMessage: string): void {
    this.api.put('/config/general', body).subscribe({
      next: () => this.snack.open(okMessage, 'Close', { duration: 2500 }),
      error: err => showHttpError(this.snack, err, failMessage),
    });
  }

  saveCacheSize(): void {
    if (!this.checkInt(this.cacheSizeMB, 16, 65536, 'Article cache')) return;
    this.putGeneral(
      { cache_size: this.cacheSizeMB * 1024 ** 2 },
      'Article cache saved. Restart to apply.',
      'Failed to save article cache',
    );
  }

  saveAutoSort(): void {
    this.putGeneral(
      { auto_sort_remaining_pct: this.autoSortRemainingPct },
      this.autoSortRemainingPct ? 'Queue auto-sort enabled' : 'Queue auto-sort disabled',
      'Failed to save queue order',
    );
  }

  saveFailureDetection(): void {
    const pct = this.requiredCompletionPct;
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 100 || pct > 200) {
      this.snack.open('Required completion must be between 100 and 200', 'Close', { duration: 3000 });
      return;
    }
    if (!this.checkInt(this.articleTimeoutSecs, 0, 3600, 'Article timeout')) return;
    this.putGeneral(
      {
        early_failure_check: this.earlyFailureCheck,
        required_completion_pct: pct,
        article_timeout_secs: this.articleTimeoutSecs,
      },
      'Failure detection saved. Restart to apply.',
      'Failed to save failure detection',
    );
  }

  savePostprocWorkers(): void {
    if (!this.checkInt(this.maxPostProcessingJobs, 1, 64, 'Parallel jobs')) return;
    if (!this.checkInt(this.maxRepairWorkers, 1, 64, 'Repair workers')) return;
    if (!this.checkInt(this.maxExtractWorkers, 1, 64, 'Extract workers')) return;
    this.putGeneral(
      {
        max_post_processing_jobs: this.maxPostProcessingJobs,
        max_repair_workers: this.maxRepairWorkers,
        max_extract_workers: this.maxExtractWorkers,
      },
      'Post-processing workers saved. Restart to apply.',
      'Failed to save post-processing workers',
    );
  }

  saveExtraction(): void {
    if (!this.checkInt(this.maxNestedArchiveDepth, 0, 10, 'Nested archive depth')) return;
    this.putGeneral(
      { direct_unpack: this.directUnpack, max_nested_archive_depth: this.maxNestedArchiveDepth },
      'Extraction settings saved. Restart to apply.',
      'Failed to save extraction settings',
    );
  }

  saveScripts(): void {
    if (!this.checkInt(this.scriptTimeoutSecs, 1, 86400, 'Script timeout')) return;
    if (!this.checkInt(this.scriptMaxOutputKiB, 0, 1024 * 1024, 'Max output')) return;
    // Empty strings clear a path on the server.
    this.putGeneral(
      {
        scripts_dir: (this.scriptsDir ?? '').trim(),
        script_success: (this.scriptSuccess ?? '').trim(),
        script_failure: (this.scriptFailure ?? '').trim(),
        script_timeout_secs: this.scriptTimeoutSecs,
        script_max_output_bytes: this.scriptMaxOutputKiB * 1024,
      },
      'Scripts saved',
      'Failed to save scripts',
    );
  }

  saveRssSettings(): void {
    // A JSON null means "unchanged" for these fields, and 0 would delete every
    // item, so blank fields are simply left out of the update.
    const body: Record<string, number> = {};
    if (this.rssHistoryLimit != null) {
      if (!this.checkInt(this.rssHistoryLimit, 1, 10_000_000, 'Keep feed items')) return;
      body['rss_history_limit'] = this.rssHistoryLimit;
    }
    if (this.rssExpiryDays != null) {
      if (!this.checkInt(this.rssExpiryDays, 1, 36_500, 'Expire downloaded')) return;
      body['rss_downloaded_item_expiry_days'] = this.rssExpiryDays;
    }
    if (Object.keys(body).length === 0) {
      this.snack.open('Nothing to save — blank fields keep their current value', 'Close', { duration: 3000 });
      return;
    }
    this.putGeneral(body, 'RSS settings saved', 'Failed to save RSS settings');
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
    const restartRequired = payload.enabled !== this.davRuntimeEnabled();
    this.api.put('/config/dav', payload).subscribe({
      next: () =>
        this.snack.open(
          restartRequired ? 'Media Library settings saved. Restart required.' : 'Media Library settings saved',
          'Close',
          { duration: 2500 },
        ),
      error: err => showHttpError(this.snack, err, 'Failed to save Media Library settings'),
    });
  }

  davBaseUrl(): string {
    // Use the browser origin so the URL also works behind a reverse proxy.
    return `${window.location.origin}/dav`;
  }

  davRestartRequired(): boolean {
    return this.webdavAvailable() && this.davConfig.enabled !== this.davRuntimeEnabled();
  }

  davAuthConfigured(): boolean {
    const c = this.davConfig;
    return !!(c.username?.trim() || c.password?.trim() || c.api_key?.trim());
  }

  generateDavApiKey(): void {
    const regenerating = !!this.davConfig.api_key?.trim();
    const doGenerate = () => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      this.davConfig.api_key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      this.showDavApiKey = true;
    };
    if (!regenerating) {
      doGenerate();
      return;
    }
    this.confirmSvc
      .confirm({
        title: 'Generate a new API key?',
        message:
          'This replaces the current key once you save. Any WebDAV client using the old key will stop working until you update it.',
        confirmLabel: 'Generate new key',
        danger: true,
      })
      .subscribe(ok => {
        if (ok) doGenerate();
      });
  }

  copy(text: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.snack.open('Copied', 'Close', { duration: 1500 }),
      () => this.snack.open('Copy failed', 'Close', { duration: 2000 }),
    );
  }
}
