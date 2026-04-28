import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import {
  MatBottomSheetRef,
  MatBottomSheetModule,
  MAT_BOTTOM_SHEET_DATA,
} from '@angular/material/bottom-sheet';
import { AuthService } from '../core/services/auth.service';
import { WidthModeService } from '../core/services/width-mode.service';

export interface MoreMenuSheetData {
  webdavEnabled: boolean;
  version: string;
}

@Component({
  selector: 'app-more-menu-sheet',
  standalone: true,
  imports: [CommonModule, RouterModule, MatBottomSheetModule],
  template: `
    <div class="sheet-panel">
      <div class="sheet-handle" aria-hidden="true"></div>
      <h2 class="title">More</h2>
      <nav class="list">
        <a class="row" (click)="go('/rss')">
          <span class="mi material-icons" aria-hidden="true">rss_feed</span>
          RSS
        </a>
        <a class="row" (click)="go('/logs')">
          <span class="mi material-icons" aria-hidden="true">article</span>
          Logs
        </a>
        @if (data.webdavEnabled) {
          <a class="row" (click)="go('/media')">
            <span class="mi material-icons" aria-hidden="true">movie</span>
            Media
          </a>
        }
        <div class="row row-static">
          <span class="label">Content width</span>
          <div class="mode-toggle" role="group" aria-label="Layout width">
            <button
              type="button"
              [class.active]="widthMode.mode() === 'compact'"
              (click)="widthMode.set('compact'); $event.stopPropagation()"
            >
              <span class="mi material-icons">crop_portrait</span>
            </button>
            <button
              type="button"
              [class.active]="widthMode.mode() === 'expanded'"
              (click)="widthMode.set('expanded'); $event.stopPropagation()"
            >
              <span class="mi material-icons">crop_16_9</span>
            </button>
          </div>
        </div>
        <button type="button" class="row danger" (click)="logout()">
          <span class="mi material-icons" aria-hidden="true">logout</span>
          Sign out
        </button>
      </nav>
      <p class="ver">rustnzb v{{ data.version }}</p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 400px;
        margin: 0 auto;
        background: var(--sheet-bg);
        border-radius: 16px 16px 0 0;
        padding-bottom: env(safe-area-inset-bottom, 0);
      }
      .title {
        font: var(--font-title2);
        margin: 0 0 8px 16px;
      }
      .list {
        display: flex;
        flex-direction: column;
      }
      .row,
      a.row,
      button.row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        border-bottom: 1px solid var(--line);
        color: var(--text);
        font: var(--font-body);
        padding: 14px 16px;
        min-height: 48px;
        cursor: pointer;
        text-decoration: none;
        box-sizing: border-box;
      }
      .row:hover,
      a.row:hover {
        background: rgba(128, 128, 128, 0.08);
      }
      .row.danger {
        color: var(--danger);
      }
      .row-static {
        flex-wrap: wrap;
        cursor: default;
      }
      .row-static .label {
        color: var(--text-secondary);
        font: var(--font-subheadline);
      }
      .mi {
        font-size: 22px;
        opacity: 0.9;
      }
      .mode-toggle {
        display: inline-flex;
        margin-left: auto;
        background: var(--panel2);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 2px;
        gap: 2px;
      }
      .mode-toggle button {
        background: none;
        border: none;
        color: var(--text-secondary);
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .mode-toggle button.active {
        background: var(--card);
        color: var(--tint);
        box-shadow: inset 0 0 0 1px var(--line);
      }
      .ver {
        text-align: center;
        color: var(--text-secondary);
        font: var(--font-footnote);
        margin: 12px 0 8px;
      }
    `,
  ],
})
export class MoreMenuSheetComponent {
  private ref = inject(MatBottomSheetRef<MoreMenuSheetComponent>);
  private router = inject(Router);
  private auth = inject(AuthService);
  widthMode = inject(WidthModeService);
  data = inject<MoreMenuSheetData>(MAT_BOTTOM_SHEET_DATA);

  go(path: string): void {
    this.ref.dismiss();
    void this.router.navigateByUrl(path);
  }

  logout(): void {
    this.ref.dismiss();
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}
