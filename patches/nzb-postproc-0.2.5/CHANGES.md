# Changes to nzb-postproc v0.2.5 (patched)

## Fix 1: RAR extraction failure with p7zip (`-p-` flag)

### Problem
When no archive password is provided, `extract_rar()` and `extract_7z()` passed
`-p-` to the 7z binary. p7zip's built-in RAR codec misinterprets this flag as
"this archive requires a password" and fails with:

```
ERROR: Cannot open the file as archive
```

This caused post-processing to fail even though PAR2 verification passed and
all files were intact. The download was marked as "Failed" and moved to history.

### Root Cause
- `unpack.rs` (extract_rar): `-p-` passed to 7z as fallback RAR extractor
- `unpack.rs` (extract_7z): same `-p-` pattern for 7z archives
- p7zip's RAR codec treats `-p-` differently than unrar does

### Fix
- `extract_rar()`: When using 7z (no unrar available), only pass `-p<pw>` when a
  password is actually provided. When using unrar, keep `-p-` (unrar handles it
  correctly). `Stdio::null()` on stdin prevents interactive password prompts.
- `extract_7z()`: Same fix — only pass `-p<pw>` when password is provided.

### Files Changed
- `src/unpack.rs`: Fixed both `extract_rar()` and `extract_7z()` functions

## Fix 2: Missing cleanup for plain `.7z` and `.zip` archives

### Problem
`is_cleanup_candidate()` in `detect.rs` identified par2, .rar, .rNN, split .7z.001,
and .7z.enc files for cleanup, but NOT plain `.7z` or `.zip` archives. After
successful extraction, these files were left on disk, wasting space.

### Fix
Added `.7z` and `.zip` to the cleanup candidate list in `is_cleanup_candidate()`.

### Files Changed
- `src/detect.rs`: Added `.7z` and `.zip` cleanup patterns
