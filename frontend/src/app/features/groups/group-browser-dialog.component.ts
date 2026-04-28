import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { GroupService } from '../../core/services/group.service';
import { GroupRow } from '../../core/models/group.model';

@Component({
  selector: 'app-group-browser-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatSnackBarModule],
  template: `
    <h2 mat-dialog-title>Browse Newsgroups</h2>
    <mat-dialog-content>
      <div class="toolbar">
        <button class="tool-btn" (click)="refresh()" [disabled]="refreshing()">↻ Refresh from Server</button>
        <input [(ngModel)]="search" (keyup.enter)="loadGroups()" placeholder="Search groups..." class="search-input" />
      </div>
      @if (refreshing()) { <mat-progress-bar mode="indeterminate"></mat-progress-bar> }
      <div class="group-list">
        @for (g of groups(); track g.id) {
          <div class="group-row">
            <span class="gname">{{ g.name }}</span>
            <span class="gcount">{{ g.article_count | number }}</span>
            <button class="sub-btn" [class.subscribed]="g.subscribed" (click)="toggleSub(g)">
              {{ g.subscribed ? '★' : '☆' }}
            </button>
          </div>
        }
        @if (groups().length === 0 && !refreshing()) {
          <div class="empty">No groups found. Click Refresh to load from server.</div>
        }
      </div>
      @if (total() > groups().length) {
        <div class="more"><button class="tool-btn" (click)="loadMoreGroups()">Load more ({{ total() - groups().length }} remaining)</button></div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
    .search-input { flex: 1; padding: 6px 10px; background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; color: var(--text); font-size: 13px; outline: none; }
    .search-input:focus { border-color: var(--tint); }
    .tool-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel2); color: var(--text); cursor: pointer; font-size: 12px; white-space: nowrap; }
    .tool-btn:hover { background: var(--card); }
    .tool-btn:disabled { opacity: 0.4; }
    .group-list { max-height: min(400px, 60vh); overflow-y: auto; }
    .group-row { display: flex; align-items: center; padding: 6px 4px; border-bottom: 1px solid var(--line); font-size: 13px; }
    .gname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gcount { width: 80px; text-align: right; color: var(--text-secondary); font-size: 12px; padding: 0 8px; }
    .sub-btn {
      min-width: 44px; min-height: 44px;
      display: inline-flex; align-items: center; justify-content: center;
      background: none; border: none; font-size: 20px; line-height: 1;
      cursor: pointer; color: var(--text-secondary); padding: 0; border-radius: 8px;
    }
    .sub-btn:hover { background: var(--panel2); }
    .sub-btn.subscribed { color: var(--warn, #e5a00d); }
    .empty { padding: 24px; text-align: center; color: var(--text-secondary); }
    .more { text-align: center; padding: 8px; }
  `],
})
export class GroupBrowserDialogComponent implements OnInit {
  groups = signal<GroupRow[]>([]);
  total = signal(0);
  search = '';
  offset = 0;
  refreshing = signal(false);

  constructor(private svc: GroupService, private snack: MatSnackBar, private dialogRef: MatDialogRef<GroupBrowserDialogComponent>) {}

  ngOnInit(): void { this.loadGroups(); }

  loadGroups(): void {
    this.offset = 0;
    this.svc.list({ search: this.search || undefined, limit: 100, offset: 0 }).subscribe(r => {
      this.groups.set(r.groups); this.total.set(r.total);
    });
  }

  loadMoreGroups(): void {
    this.offset += 100;
    this.svc.list({ search: this.search || undefined, limit: 100, offset: this.offset }).subscribe(r => {
      this.groups.set([...this.groups(), ...r.groups]);
    });
  }

  refresh(): void {
    this.refreshing.set(true);
    this.svc.refresh().subscribe({
      next: r => { this.refreshing.set(false); this.snack.open(r.message, 'Close', { duration: 3000 }); this.loadGroups(); },
      error: (e: HttpErrorResponse) => {
        this.refreshing.set(false);
        const msg = e.status === 400
          ? (e.error?.human_readable || 'No servers configured — add one in Settings first.')
          : 'Refresh failed';
        this.snack.open(msg, 'Close', { duration: 5000 });
      },
    });
  }

  toggleSub(g: GroupRow): void {
    const obs = g.subscribed ? this.svc.unsubscribe(g.id) : this.svc.subscribe(g.id);
    obs.subscribe(() => { g.subscribed = !g.subscribed; this.groups.set([...this.groups()]); });
  }
}
