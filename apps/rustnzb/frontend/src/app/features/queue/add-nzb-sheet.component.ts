import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatBottomSheetRef, MAT_BOTTOM_SHEET_DATA, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { showHttpError } from '../../core/http/http-error';

export interface AddNzbSheetData {
  categories: { name: string; output_dir: string | null; post_processing: number }[];
}

@Component({
  selector: 'app-add-nzb-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, MatBottomSheetModule, MatSnackBarModule],
  template: `
    <div class="sheet-panel">
      <div class="sheet-handle" aria-hidden="true"></div>
      <h2 class="sheet-title">Add NZB</h2>
      <p class="sheet-sub">Upload .nzb files or paste a URL</p>

      <div class="add-tabs">
        <button type="button" class="btn sm" [class.primary]="addMode === 'file'" (click)="addMode = 'file'">Upload files</button>
        <button type="button" class="btn sm" [class.primary]="addMode === 'url'" (click)="addMode = 'url'">From URL</button>
      </div>

      @if (addMode === 'file') {
        <div
          class="dropzone"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
          [class.dragover]="isDragging"
        >
          <div class="dz-title">Drop files here or click to browse</div>
          <div class="dz-hint">.nzb, .zip, .rar, .7z, .gz — multiple files supported</div>
          <input
            type="file"
            accept=".nzb,.zip,.rar,.7z,.gz"
            multiple
            class="dz-input"
            (change)="onFilesSelected($event)"
          />
        </div>
        @if (selectedFiles.length > 0) {
          <div class="file-chips">
            @for (f of selectedFiles; track $index) {
              <div class="file-chip">
                <span>{{ f.name }}</span>
                <button
                  type="button"
                  class="chip-x"
                  (click)="removeFile(f)"
                  [attr.aria-label]="'Remove ' + f.name"
                >
                  ✕
                </button>
              </div>
            }
          </div>
        }
      } @else {
        <input
          type="url"
          aria-label="NZB URL"
          class="url-input"
          placeholder="https://example.com/file.nzb"
          [(ngModel)]="addUrl"
          (keydown.enter)="addFromUrl()"
        />
      }

      <div class="add-options">
        @if (addMode === 'url' || selectedFiles.length <= 1) {
          <div class="add-field add-field--wide">
            <label for="add-nzb-name">Job name <span class="opt">(optional)</span></label>
            <input
              id="add-nzb-name"
              type="text"
              [(ngModel)]="addName"
              placeholder="Defaults to the NZB file name"
              autocomplete="off"
            />
          </div>
        }
        <div class="add-field add-field--wide">
          <label for="add-nzb-password">Archive password <span class="opt">(optional)</span></label>
          <input
            id="add-nzb-password"
            type="password"
            [(ngModel)]="addPassword"
            placeholder="Overrides a password embedded in the NZB"
            autocomplete="new-password"
          />
        </div>
        <div class="add-field">
          <label for="add-nzb-category">Category</label>
          <select id="add-nzb-category" [(ngModel)]="addCategory">
            <option value="">None</option>
            @for (cat of data.categories; track cat.name) {
              <option [value]="cat.name">{{ cat.name }}</option>
            }
          </select>
        </div>
        <div class="add-field">
          <label for="add-nzb-priority">Priority</label>
          <select id="add-nzb-priority" [(ngModel)]="addPriority">
            <option [ngValue]="0">Low</option>
            <option [ngValue]="1">Normal</option>
            <option [ngValue]="2">High</option>
            <option [ngValue]="3">Force</option>
          </select>
        </div>
      </div>
      <div class="row-actions">
        <button type="button" class="btn ghost" (click)="dismiss()">Cancel</button>
        @if (addMode === 'file') {
          <button
            type="button"
            class="btn primary"
            [disabled]="selectedFiles.length === 0 || uploading"
            (click)="uploadFiles()"
          >
            {{ uploading ? 'Uploading...' : selectedFiles.length > 1 ? 'Upload ' + selectedFiles.length + ' files' : 'Upload' }}
          </button>
        } @else {
          <button type="button" class="btn primary" [disabled]="!addUrl.trim() || uploading" (click)="addFromUrl()">
            {{ uploading ? 'Adding...' : 'Add' }}
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 560px;
        margin: 0 auto;
        padding: 0 8px 16px;
        background: var(--sheet-bg);
        border-radius: 16px 16px 0 0;
      }
      .sheet-title {
        font: var(--font-title3);
        margin: 0 0 4px;
        padding: 0 8px;
      }
      .sheet-sub {
        font: var(--font-subheadline);
        color: var(--text-secondary);
        margin: 0 0 12px;
        padding: 0 8px;
      }
      .add-tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        padding: 0 8px;
      }
      .dropzone {
        border: 2px dashed var(--line);
        border-radius: 10px;
        padding: 24px;
        text-align: center;
        position: relative;
        cursor: pointer;
        margin: 0 8px 8px;
      }
      .dropzone:hover,
      .dropzone.dragover {
        border-color: var(--tint);
        background: color-mix(in srgb, var(--tint) 8%, transparent);
      }
      .dz-title {
        font: var(--font-subheadline);
        margin-bottom: 4px;
      }
      .dz-hint {
        font: var(--font-footnote);
        color: var(--text-secondary);
      }
      .dz-input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
        width: 100%;
        height: 100%;
      }
      .file-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0 8px 8px;
      }
      .file-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--panel2);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 4px 10px;
        font: var(--font-footnote);
      }
      .chip-x {
        color: var(--mute);
        cursor: pointer;
        background: none;
        border: none;
        padding: 0 2px;
        font: inherit;
      }
      .chip-x:hover {
        color: var(--text);
      }
      .url-input {
        width: calc(100% - 16px);
        margin: 0 8px 8px;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: var(--panel2);
        color: var(--text);
        font: inherit;
      }
      .add-options {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 8px 8px 0;
      }
      .add-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .add-field label {
        font: var(--font-footnote);
        color: var(--text-secondary);
      }
      .add-field--wide {
        flex: 1 1 100%;
      }
      .add-field .opt {
        color: var(--mute);
      }
      .add-field input {
        background: var(--panel2);
        border: 1px solid var(--line);
        color: var(--text);
        padding: 8px 10px;
        border-radius: 8px;
        min-height: 44px;
        box-sizing: border-box;
        width: 100%;
        font: inherit;
      }
      .add-field select {
        min-width: 160px;
        background: var(--panel2);
        border: 1px solid var(--line);
        color: var(--text);
        padding: 8px 10px;
        border-radius: 8px;
        min-height: 44px;
      }
      .row-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 16px;
        padding: 0 8px;
      }
    `,
  ],
})
export class AddNzbSheetComponent implements OnInit {
  private ref = inject(MatBottomSheetRef<AddNzbSheetComponent>);
  private http = inject(HttpClient);
  private api = inject(ApiService);
  private snackBar = inject(MatSnackBar);
  data: AddNzbSheetData = inject(MAT_BOTTOM_SHEET_DATA);

  addMode: 'file' | 'url' = 'file';
  selectedFiles: File[] = [];
  addUrl = '';
  addCategory = '';
  addPriority = 1;
  addName = '';
  addPassword = '';
  uploading = false;
  isDragging = false;

  ngOnInit(): void {
    if (!this.data) this.data = { categories: [] };
    if (!this.data.categories?.length) {
      this.api.get<{ name: string; output_dir: string | null; post_processing: number }[]>('/config/categories').subscribe({
        next: cats => (this.data = { categories: cats }),
        error: () => (this.data = { categories: [] }),
      });
    }
  }

  dismiss(): void {
    this.ref.dismiss();
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = true;
  }
  onDragLeave(_e: DragEvent): void {
    this.isDragging = false;
  }
  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = false;
    if (e.dataTransfer?.files) {
      this.selectedFiles = [...this.selectedFiles, ...Array.from(e.dataTransfer.files)];
    }
  }
  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.selectedFiles = [...this.selectedFiles, ...Array.from(input.files)];
  }
  removeFile(file: File): void {
    this.selectedFiles = this.selectedFiles.filter(f => f !== file);
  }

  uploadFiles(): void {
    if (this.selectedFiles.length === 0 || this.uploading) return;
    this.uploading = true;
    const formData = new FormData();
    for (const file of this.selectedFiles) formData.append('file', file, file.name);
    // Job options travel as multipart text fields (the password is only
    // accepted there, never in the query string).
    if (this.addCategory) formData.append('category', this.addCategory);
    if (this.addPriority !== 1) formData.append('priority', String(this.addPriority));
    const name = this.addName.trim();
    if (name && this.selectedFiles.length === 1) formData.append('name', name);
    if (this.addPassword) formData.append('password', this.addPassword);
    const token = localStorage.getItem('access_token');
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    this.http.post('/api/queue/add', formData, { headers }).subscribe({
      next: () => {
        const count = this.selectedFiles.length;
        this.snackBar.open(`${count} NZB${count > 1 ? 's' : ''} added to queue`, 'Close', {
          duration: 3000,
        });
        this.uploading = false;
        this.ref.dismiss(true);
      },
      error: (err: { status?: number }) => {
        this.uploading = false;
        const fallback = err?.status === 413 ? 'Upload too large' : 'Upload failed';
        showHttpError(this.snackBar, err, fallback);
      },
    });
  }

  addFromUrl(): void {
    const url = this.addUrl.trim();
    if (!url || this.uploading) return;
    this.uploading = true;
    const body: { url: string; name?: string; category?: string; priority?: number; password?: string } = {
      url,
    };
    const name = this.addName.trim();
    if (name) body.name = name;
    if (this.addCategory) body.category = this.addCategory;
    if (this.addPriority !== 1) body.priority = this.addPriority;
    if (this.addPassword) body.password = this.addPassword;
    this.api.post('/queue/add-url', body).subscribe({
      next: () => {
        this.snackBar.open('NZB added from URL', 'Close', { duration: 3000 });
        this.uploading = false;
        this.ref.dismiss(true);
      },
      error: (err: unknown) => {
        this.uploading = false;
        showHttpError(this.snackBar, err, 'Failed to add NZB from URL');
      },
    });
  }
}
