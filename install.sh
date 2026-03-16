#!/usr/bin/env bash
set -euo pipefail

BLD=$'\e[1m'; GRN=$'\e[32m'; CYN=$'\e[36m'; YLW=$'\e[33m'; RED=$'\e[31m'; RST=$'\e[0m'; DIM=$'\e[2m'

echo
echo "${BLD}${CYN}  ╔══════════════════════════════════╗${RST}"
echo "${BLD}${CYN}  ║    Lock Dock  ·  installer        ║${RST}"
echo "${BLD}${CYN}  ╚══════════════════════════════════╝${RST}"
echo

[[ "$(uname)" == "Darwin" ]] || { echo "${RED}  ✖ macOS only.${RST}"; exit 1; }
command -v node &>/dev/null || { echo "${RED}  ✖ Node.js not found. Install from https://nodejs.org${RST}"; exit 1; }

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
MAJOR=${NODE_VER%%.*}
(( MAJOR >= 18 )) || { echo "${RED}  ✖ Node.js 18+ required (found v${NODE_VER}).${RST}"; exit 1; }
echo "  ${DIM}Node.js v${NODE_VER} ✔${RST}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.lock-dock"
BIN_PATH="/usr/local/bin/lock-dock"

echo "  Installing to ${CYN}${INSTALL_DIR}${RST}…"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/dist"

cp -r "$SCRIPT_DIR/node_modules" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/dist"         "$INSTALL_DIR/"
cp    "$SCRIPT_DIR/index.js"     "$INSTALL_DIR/"
cp    "$SCRIPT_DIR/package.json" "$INSTALL_DIR/"
cp    "$SCRIPT_DIR/bin/lock-dock.js" "$INSTALL_DIR/bin/"
echo "  ${GRN}Files copied ✔${RST}"

echo "  Linking command…"
LAUNCHER="#!/usr/bin/env bash
exec node \"${INSTALL_DIR}/dist/index.js\" \"\$@\""

if printf '%s\n' "$LAUNCHER" > "$BIN_PATH" 2>/dev/null; then
  chmod +x "$BIN_PATH"
  echo "  ${GRN}✔ lock-dock → ${BIN_PATH}${RST}"
else
  echo "  ${YLW}⚠  Needs sudo to write to /usr/local/bin…${RST}"
  echo "$LAUNCHER" | sudo tee "$BIN_PATH" > /dev/null
  sudo chmod +x "$BIN_PATH"
  echo "  ${GRN}✔ lock-dock → ${BIN_PATH}${RST}"
fi

echo
echo "${BLD}  ✔ Done! Run:  ${CYN}lock-dock${RST}"
echo
