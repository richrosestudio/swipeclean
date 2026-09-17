#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "Install GitHub CLI first: brew install gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Sign in to GitHub:"
  gh auth login
fi

OWNER="$(gh api user -q .login)"
REPO="swipeclean"

if git remote get-url origin >/dev/null 2>&1; then
  echo "Remote origin already set:"
  git remote -v
else
  gh repo create "${OWNER}/${REPO}" \
    --public \
    --description "Swipe through files one at a time and trash only what you do not need." \
    --source=. \
    --remote=origin \
    --push
fi

echo
echo "Repo: https://github.com/${OWNER}/${REPO}"
echo
echo "Next steps:"
echo "  1. In GitHub repo Settings -> Pages, confirm Source is 'GitHub Actions'."
echo "  2. Push a site change or run the 'Deploy site' workflow to publish the landing page."
echo "  3. Tag a release to build installers:"
echo "       git tag v0.1.0"
echo "       git push origin v0.1.0"
echo
echo "Download button target:"
echo "  https://github.com/${OWNER}/${REPO}/releases/latest"
