#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
export PORT="${PORT:-3025}"
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 22.13 or later is required. Install Node, then open this launcher again.'
  read '?Press Enter to close.'
  exit 1
fi
if ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)'; then
  print 'Update Node.js to 22.13 or later, then open this launcher again.'
  read '?Press Enter to close.'
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ ! -f .next/BUILD_ID ]]; then npm run build; fi
node scripts/check-port.mjs
npm start &
workbench_pid=$!
trap 'kill "$workbench_pid" 2>/dev/null || true' EXIT INT TERM
for attempt in {1..60}; do
  if curl --silent --fail "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    open "http://127.0.0.1:${PORT}"
    break
  fi
  sleep 1
done
wait "$workbench_pid"
