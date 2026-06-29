#!/usr/bin/env bash
# Start Open Design daemon + web UI (requires Node 24 + pnpm 10.33.2)
set -euo pipefail

OD_ROOT="${OPEN_DESIGN_ROOT:-$HOME/dev/open-design}"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1090
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm use 24 >/dev/null
corepack enable >/dev/null 2>&1 || true

cd "$OD_ROOT"
pnpm tools-dev start web
pnpm tools-dev status
