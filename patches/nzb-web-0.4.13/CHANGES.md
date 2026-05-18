# Changes to nzb-web v0.4.13 (patched)

## Bug Fix: `-p-` flag truncates RAR5 extraction in direct_unpack

**File:** `src/direct_unpack.rs` (line 274-276)

**Problem:**
When no password is set, `unpack_set()` passes `-p-` to unrar. On RAR5 archives,
this causes unrar to produce truncated output (~100MB instead of ~5.5GB).

**Fix:**
- Omit the password flag entirely when no password is set (empty String)
- Only pass `-p<password>` when a password is actually provided
- Skip empty pw_flag argument in Command builder

**Same bug existed in nzb-postproc's unpack.rs — fixed there too.**
