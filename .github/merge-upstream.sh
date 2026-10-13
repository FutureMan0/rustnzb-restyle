#!/usr/bin/env bash
# Merge upstream rustnzb into this fork without bringing back upstream's
# workflows (they target upstream's self-hosted runners and registry).
#
#   .github/merge-upstream.sh            # merges upstream/main
#   .github/merge-upstream.sh v1.7.0     # merges a tag or other ref
set -euo pipefail

UPSTREAM_URL=https://github.com/TheDancingDeveloper-org/rustnzb.git
REF=${1:-upstream/main}
# Workflows that belong to the fork; everything else under .github/workflows is upstream's.
FORK_WORKFLOWS=(docker.yml fork-ci.yml)

cd "$(git rev-parse --show-toplevel)"
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"
git fetch upstream --tags

if [ "$(git rev-parse --abbrev-ref HEAD)" = main ]; then
  echo "Run this on a branch, e.g.: git switch -c merge/upstream-$(date +%Y%m%d)" >&2
  exit 1
fi

git merge --no-ff --no-commit "$REF" || true

is_fork_workflow() {
  local name
  name=$(basename "$1")
  for keep in "${FORK_WORKFLOWS[@]}"; do [ "$name" = "$keep" ] && return 0; done
  return 1
}

# Drop upstream workflows (new, changed or conflicting) and upstream's CodeQL config.
while IFS= read -r path; do
  is_fork_workflow "$path" && continue
  git rm -q --cached --ignore-unmatch -- "$path"
  rm -f -- "$path"
done < <(
  { git diff --name-only --cached; git diff --name-only --diff-filter=U; } \
    | grep -E '^\.github/(workflows/|codeql/)' | sort -u
)

echo
echo "Remaining conflicts (resolve, run the checks from CLAUDE.md, then git commit):"
git diff --name-only --diff-filter=U || true
