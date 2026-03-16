#!/usr/bin/env bash
# Lock Dock — install directly from GitHub
# Usage: curl -fsSL https://raw.githubusercontent.com/tabspacecoder/lockdock/main/install-from-github.sh | bash

set -euo pipefail

REPO="tabspacecoder/lockdock"
BRANCH="main"
RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
INSTALL_DIR="$HOME/.lock-dock"
BIN_PATH="/usr/local/bin/lock-dock"

BLD=$'\e[1m'; GRN=$'\e[32m'; CYN=$'\e[36m'; YLW=$'\e[33m'; RED=$'\e[31m'; RST=$'\e[0m'; DIM=$'\e[2m'

echo
echo "${BLD}${CYN}  ╔══════════════════════════════════════╗${RST}"
echo "${BLD}${CYN}  ║   Lock Dock  ·  installer             ║${RST}"
echo "${BLD}${CYN}  ║   github.com/${REPO}  ║${RST}"
echo "${BLD}${CYN}  ╚══════════════════════════════════════╝${RST}"
echo

# ── Platform ──────────────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || { echo "${RED}  ✖ macOS only.${RST}"; exit 1; }

# ── Node.js ───────────────────────────────────────────────
command -v node &>/dev/null || {
  echo "${RED}  ✖ Node.js not found.${RST}"
  echo "  Install from ${CYN}https://nodejs.org${RST} then re-run this script."
  exit 1
}
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
MAJOR=${NODE_VER%%.*}
(( MAJOR >= 18 )) || {
  echo "${RED}  ✖ Node.js 18+ required (found v${NODE_VER}).${RST}"
  echo "  Download a newer version from ${CYN}https://nodejs.org${RST}"
  exit 1
}
echo "  ${DIM}Node.js v${NODE_VER} ✔${RST}"

# ── curl / wget ───────────────────────────────────────────
if command -v curl &>/dev/null; then
  FETCH="curl -fsSL"
elif command -v wget &>/dev/null; then
  FETCH="wget -qO-"
else
  echo "${RED}  ✖ curl or wget is required.${RST}"; exit 1
fi

# ── Download ──────────────────────────────────────────────
echo "  Downloading from ${CYN}github.com/${REPO}${RST}…"

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/dist" "$INSTALL_DIR/bin"

# Core files
$FETCH "${RAW}/dist/index.js"        > "$INSTALL_DIR/dist/index.js"
$FETCH "${RAW}/index.js"             > "$INSTALL_DIR/index.js"
$FETCH "${RAW}/package.json"         > "$INSTALL_DIR/package.json"
$FETCH "${RAW}/babel.config.json"    > "$INSTALL_DIR/babel.config.json"
$FETCH "${RAW}/bin/lock-dock.js"     > "$INSTALL_DIR/bin/lock-dock.js"
chmod +x "$INSTALL_DIR/bin/lock-dock.js"
echo "  ${GRN}Files downloaded ✔${RST}"

# ── Dependencies ──────────────────────────────────────────
echo "  Installing dependencies (this takes ~30 s)…"
cd "$INSTALL_DIR"
npm install --omit=dev --silent 2>/dev/null || npm install --omit=dev 2>&1 | tail -3
echo "  ${GRN}Dependencies installed ✔${RST}"

# ── Global command ────────────────────────────────────────
echo "  Linking ${BLD}lock-dock${RST} command…"

write_launcher() {
  printf '#!/usr/bin/env bash\nexec node "%s/dist/index.js" "$@"\n' "$INSTALL_DIR" > "$BIN_PATH"
  chmod +x "$BIN_PATH"
}

if write_launcher 2>/dev/null; then
  echo "  ${GRN}✔ lock-dock → ${BIN_PATH}${RST}"
else
  echo "  ${YLW}⚠  Needs sudo to write to /usr/local/bin…${RST}"
  sudo bash -c "printf '#!/usr/bin/env bash\nexec node \"%s/dist/index.js\" \"\$@\"\n' '$INSTALL_DIR' > '$BIN_PATH' && chmod +x '$BIN_PATH'"
  echo "  ${GRN}✔ lock-dock → ${BIN_PATH}${RST}"
fi

echo
echo "${BLD}  ✔ Done! Run:  ${CYN}lock-dock${RST}"
echo
