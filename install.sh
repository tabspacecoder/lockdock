#!/usr/bin/env bash
# lock-dock installer
set -euo pipefail

BLD=$'\e[1m'; GRN=$'\e[32m'; CYN=$'\e[36m'; YLW=$'\e[33m'; RED=$'\e[31m'; RST=$'\e[0m'; DIM=$'\e[2m'

echo
echo "${BLD}${CYN}  ╔══════════════════════════════════╗${RST}"
echo "${BLD}${CYN}  ║  Lock Dock  installer             ║${RST}"
echo "${BLD}${CYN}  ╚══════════════════════════════════╝${RST}"
echo

[[ "$(uname)" == "Darwin" ]] || { echo "${RED}  ✖ macOS only.${RST}"; exit 1; }
command -v node &>/dev/null  || { echo "${RED}  ✖ Node.js not found.${RST}"; echo "  Install from https://nodejs.org"; exit 1; }

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
MAJOR=${NODE_VER%%.*}
(( MAJOR >= 18 )) || { echo "${RED}  ✖ Node.js 18+ required (found v${NODE_VER}).${RST}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.lock-dock"
BIN_PATH="/usr/local/bin/lock-dock"

echo "  ${DIM}Node.js v${NODE_VER} ✔${RST}"
echo "  Installing to ${CYN}${INSTALL_DIR}${RST}…"

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/dist" "$INSTALL_DIR/bin"

# Copy source files
cp "$SCRIPT_DIR/index.js"        "$INSTALL_DIR/"
cp "$SCRIPT_DIR/package.json"    "$INSTALL_DIR/"
cp "$SCRIPT_DIR/babel.config.json" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/bin/lock-dock.js"  "$INSTALL_DIR/bin/"

# Install deps and build
echo "  Installing dependencies…"
cd "$INSTALL_DIR"
npm install --omit=dev --silent 2>/dev/null
npm install --save-dev @babel/cli @babel/core @babel/preset-env @babel/preset-react --silent 2>/dev/null
echo "  Building…"
node_modules/.bin/babel index.js -o dist/index.js

# Write the global launcher
cat > /tmp/_lock_dock_launcher << LAUNCHER
#!/usr/bin/env bash
exec node "${INSTALL_DIR}/dist/index.js" "\$@"
LAUNCHER
chmod +x /tmp/_lock_dock_launcher

if cp /tmp/_lock_dock_launcher "$BIN_PATH" 2>/dev/null; then
  echo "  ${GRN}✔ Installed → ${BIN_PATH}${RST}"
else
  echo "  ${YLW}⚠  Needs sudo to write to /usr/local/bin…${RST}"
  sudo cp /tmp/_lock_dock_launcher "$BIN_PATH"
  echo "  ${GRN}✔ Installed → ${BIN_PATH}${RST}"
fi

echo
echo "${BLD}  All done! Run:  ${CYN}lock-dock${RST}"
echo
