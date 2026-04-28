import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';

/** Best-effort message from JSON or text error bodies (Axum often uses `message` or `error`). */
function apiErrorText(err: unknown): string | null {
  if (err == null) return null;
  if (typeof err === 'string') return err.trim() || null;
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o['message'] === 'string') return o['message'];
    if (typeof o['error'] === 'string') return o['error'];
  }
  return null;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-header">
          <img src="/logo.png" alt="rustnzb" class="login-logo" />
          @if (isSetup()) {
            <p class="login-subtitle">Create your account to get started</p>
          } @else {
            <p class="login-subtitle">Sign in to continue</p>
          }
        </div>

        @if (loading()) {
          <div class="login-loading">Checking status...</div>
        } @else {
          <form (ngSubmit)="onSubmit()" class="login-form">
            @if (errorMessage()) {
              <div class="login-error">{{ errorMessage() }}</div>
            }

            <div class="form-group">
              <label class="form-label" for="username">Username</label>
              <input
                id="username"
                type="text"
                class="form-input"
                [(ngModel)]="username"
                name="username"
                autocomplete="username"
                required
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="password">Password</label>
              <input
                id="password"
                type="password"
                class="form-input"
                [(ngModel)]="password"
                name="password"
                autocomplete="current-password"
                required
              />
            </div>

            @if (isSetup()) {
              <div class="form-group">
                <label class="form-label" for="confirmPassword">Confirm Password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  class="form-input"
                  [(ngModel)]="confirmPassword"
                  name="confirmPassword"
                  autocomplete="new-password"
                  required
                />
              </div>
            }

            <button type="submit" class="submit-btn" [disabled]="submitting()">
              @if (submitting()) {
                @if (isSetup()) { Creating Account... } @else { Signing In... }
              } @else {
                @if (isSetup()) { Create Account } @else { Sign In }
              }
            </button>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    .login-wrapper {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: var(--bg); padding: 16px;
    }

    .login-card {
      width: 100%; max-width: 400px; background: var(--card);
      border: 1px solid var(--line); border-radius: 14px; padding: 32px;
    }

    .login-header { text-align: center; margin-bottom: 24px; }

    .login-logo { width: min(220px, 60vw); height: auto; }

    .login-subtitle {
      color: var(--text-secondary); font-size: 14px; margin: 8px 0 0;
    }

    .login-loading {
      text-align: center; color: var(--text-secondary); padding: 24px 0;
    }

    .login-form { display: flex; flex-direction: column; gap: 16px; }

    .login-error {
      background: color-mix(in srgb, var(--danger) 12%, transparent);
      border: 1px solid var(--danger);
      border-radius: 8px; padding: 10px 14px; color: var(--danger);
      font-size: 13px;
    }

    .form-group { display: flex; flex-direction: column; gap: 6px; }

    .form-label { color: var(--text); font-size: 13px; font-weight: 600; }

    .form-input {
      background: var(--bg-elevated, var(--bg));
      border: 1px solid var(--line); border-radius: 8px;
      padding: 10px 12px; color: var(--text); font-size: 14px;
      outline: none; transition: border-color 0.15s ease;
    }
    .form-input:focus { border-color: var(--tint); }
    .form-input::placeholder { color: var(--text-secondary); }

    .submit-btn {
      background: var(--tint); border: 1px solid var(--tint); border-radius: 10px;
      padding: 14px 16px; color: #fff; font-size: 15px; font-weight: 600;
      cursor: pointer; transition: filter 0.15s ease; margin-top: 4px;
      min-height: 48px;
    }
    .submit-btn:hover:not(:disabled) { filter: brightness(1.08); }
    .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  `],
})
export class LoginComponent implements OnInit {
  username = '';
  password = '';
  confirmPassword = '';

  isSetup = signal(false);
  loading = signal(true);
  submitting = signal(false);
  errorMessage = signal('');

  constructor(
    private authService: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // If already logged in, go to queue
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/queue']);
      return;
    }

    this.authService.checkAuth().subscribe({
      next: (status) => {
        if (!status.auth_enabled && !status.setup_required) {
          // Auth is disabled, go straight to queue
          this.router.navigate(['/queue']);
          return;
        }
        this.isSetup.set(status.setup_required);
        this.loading.set(false);
      },
      error: () => {
        // If we can't reach the server, show login anyway
        this.loading.set(false);
      },
    });
  }

  onSubmit(): void {
    this.errorMessage.set('');

    if (!this.username.trim() || !this.password.trim()) {
      this.errorMessage.set('Username and password are required.');
      return;
    }

    if (this.isSetup() && this.password !== this.confirmPassword) {
      this.errorMessage.set('Passwords do not match.');
      return;
    }

    this.submitting.set(true);

    const request$ = this.isSetup()
      ? this.authService.setup(this.username, this.password)
      : this.authService.login(this.username, this.password);

    const isSetup = this.isSetup();
    request$.subscribe({
      next: () => {
        this.router.navigate(isSetup ? ['/welcome'] : ['/queue']);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        const detail = apiErrorText(err.error);
        if (err.status === 401) {
          this.errorMessage.set('Invalid username or password.');
        } else if (err.status === 409) {
          this.errorMessage.set('An account already exists. Please sign in instead.');
        } else if (detail) {
          this.errorMessage.set(detail);
        } else if (err.status === 0) {
          this.errorMessage.set(
            'Cannot reach the API. If you use the Angular dev server, start rustnzb on port 9090 (see frontend/proxy.conf.json), or point the proxy at your running instance.',
          );
        } else if (err.status === 500) {
          this.errorMessage.set(
            'Server error (500) during login. Check the rustnzb log output — often a database or auth config issue. If no account exists yet, complete the first-run setup instead of using test credentials.',
          );
        } else {
          this.errorMessage.set(
            `Request failed (${err.status || 'unknown'}). Check that the backend is running and try again.`,
          );
        }
      },
    });
  }
}
