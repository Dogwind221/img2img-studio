#!/bin/bash
# Build dsh-img2img-editor: compile the host half with the dsh checkout's tsc and
# link the few build-time dependencies (types + the client bundler) from that
# same checkout. Run `npm run build:client` (or dev_build_plugin) for lib/client.js.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# DSH_CHECKOUT 探测：环境变量 → 常见路径
CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ]; then
  for candidate in "$HOME/dsh-harness" "$HOME/dsh" "/f/dsh/_rc2-src" "/f/dsh" "$HOME/.dsh/dsh-harness"; do
    if [ -d "$candidate/packages" ]; then CHECKOUT="$candidate"; break; fi
  done
fi
if [ -z "$CHECKOUT" ] || [ ! -d "$CHECKOUT/packages" ]; then
  echo "build: cannot locate the dsh checkout (set DSH_CHECKOUT)" >&2
  exit 1
fi

TSC="$CHECKOUT/node_modules/.bin/tsc"
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  echo "build: tsc not found at $TSC" >&2
  exit 1
fi

# link_dir <node_modules 相对路径> <绝对目标>
link_dir() {
  local target="$2"
  if [ ! -e "$target" ]; then
    echo "build: dependency target missing: $target" >&2
    return 0
  fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "node_modules/$1" "$target"
}

echo "=== Linking build dependencies (checkout: $CHECKOUT) ==="
mkdir -p node_modules/@types
link_dir @types/node "$CHECKOUT/node_modules/@types/node"

# tsdown + @types/react 只存在于 pnpm store 里（checkout 顶层没有直接链接）。
find_pnpm() {
  find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname "$1" 2>/dev/null | head -1
}
TSDOWN_DIR="$(find_pnpm 'tsdown@*')"
if [ -n "$TSDOWN_DIR" ]; then link_dir tsdown "$TSDOWN_DIR/node_modules/tsdown"; fi
REACT_TYPES_DIR="$(find_pnpm '@types+react@18*')"
if [ -n "$REACT_TYPES_DIR" ]; then link_dir @types/react "$REACT_TYPES_DIR/node_modules/@types/react"; fi

# npm run 只认 node_modules/.bin：把 checkout 的 tsdown shim 复制过来
# （shim 内部用 %~dp0\..\tsdown 定位，正好命中上面的 junction）。
if [ -x "$CHECKOUT/node_modules/.bin/tsdown" ] || [ -f "$CHECKOUT/node_modules/.bin/tsdown" ]; then
  mkdir -p node_modules/.bin
  cp -f "$CHECKOUT/node_modules/.bin/tsdown" node_modules/.bin/tsdown 2>/dev/null || true
  cp -f "$CHECKOUT/node_modules/.bin/tsdown.cmd" node_modules/.bin/ 2>/dev/null || true
  cp -f "$CHECKOUT/node_modules/.bin/tsdown.ps1" node_modules/.bin/ 2>/dev/null || true
  chmod +x node_modules/.bin/tsdown 2>/dev/null || true
fi

echo "=== Compiling host half (src/index.ts) -> lib ==="
"$TSC" -p tsconfig.json

if [ -d node_modules/@types/react ]; then
  echo "=== Typechecking client half (no emit) ==="
  "$TSC" -p tsconfig.client.json
fi

echo "=== Build complete ==="
