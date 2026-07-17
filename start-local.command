#!/bin/zsh
set -e

cd -- "$(dirname -- "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20.9 or newer is required. Install it from https://nodejs.org and try again."
  read -r "?Press Return to close…"
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1)'; then
  echo "Node.js 20.9 or newer is required. Update Node.js and try again."
  read -r "?Press Return to close…"
  exit 1
fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing local dependencies…"
  npm ci
fi

needs_build=false
if [ ! -f .next/BUILD_ID ]; then
  needs_build=true
elif [ package.json -nt .next/BUILD_ID ] || [ package-lock.json -nt .next/BUILD_ID ] || [ next.config.ts -nt .next/BUILD_ID ]; then
  needs_build=true
elif [ -n "$(find src scripts -type f -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  needs_build=true
fi

if [ "$needs_build" = true ]; then
  echo "Preparing the local application…"
  npm run build
fi

npm run db:migrate
(sleep 3; open "http://127.0.0.1:3000") &
exec npm run start
