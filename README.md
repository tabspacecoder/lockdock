# Lock Dock

```
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║ ██╗      ██████╗  ██████╗██╗  ██╗   ██████╗  ██████╗  ██████╗██╗  ██╗ ║
  ║ ██║     ██╔═══██╗██╔════╝██║ ██╔╝   ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝ ║
  ║ ██║     ██║   ██║██║     █████╔╝    ██║  ██║██║   ██║██║     █████╔╝  ║
  ║ ██║     ██║   ██║██║     ██╔═██╗    ██║  ██║██║   ██║██║     ██╔═██╗  ║
  ║ ███████╗╚██████╔╝╚██████╗██║  ██╗   ██████╔╝╚██████╔╝╚██████╗██║  ██╗ ║
  ║ ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝   ╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝ ║
  ║ Lock Dock • Pin your Dock to any monitor                              ║
  ╚═══════════════════════════════════════════════════════════════════════╝
```

**An interactive terminal UI to lock your macOS Dock to a specific monitor.**

Built with [Ink](https://github.com/vadimdemedes/ink) — the same React-for-CLIs framework used by Claude Code.

---

## Install

One command installs Lock Dock globally:

```bash
curl -fsSL https://raw.githubusercontent.com/tabspacecoder/lockdock/main/install-from-github.sh | bash
```

Then run it:

```bash
lock-dock
```

> **Requirements:** macOS 10.15 Catalina or later · Node.js 18+

---

## Usage

```
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║ ██╗      ██████╗  ██████╗██╗  ██╗   ██████╗  ██████╗  ██████╗██╗  ██╗ ║
  ║ ██║     ██╔═══██╗██╔════╝██║ ██╔╝   ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝ ║
  ║ ██║     ██║   ██║██║     █████╔╝    ██║  ██║██║   ██║██║     █████╔╝  ║
  ║ ██║     ██║   ██║██║     ██╔═██╗    ██║  ██║██║   ██║██║     ██╔═██╗  ║
  ║ ███████╗╚██████╔╝╚██████╗██║  ██╗   ██████╔╝╚██████╔╝╚██████╗██║  ██╗ ║
  ║ ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝   ╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝ ║
  ║ Lock Dock • Pin your Dock to any monitor                              ║
  ╚═══════════════════════════════════════════════════════════════════════╝

  ▶ ◈ List displays     Show connected monitors
    ⊕ Lock Dock          Pin Dock to a display
    ↺ Reset / Unpin      Let Dock follow cursor
    ◎ Status             Current lock setting
    × Quit

  Dock pinned to: LG UltraWide
  ────────────────────────────────────
  ↑↓ navigate   enter select   q quit
```

### Screens

| Screen | What it does |
|---|---|
| **List displays** | Shows all connected monitors with resolution and primary indicator |
| **Lock Dock** | Arrow-key picker — choose a monitor, Dock restarts instantly |
| **Reset / Unpin** | Confirms then removes the pin, restoring macOS default behaviour |
| **Status** | Shows which display the Dock is currently pinned to |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate menu |
| `Enter` / `Space` | Select |
| `Esc` | Go back |
| `q` | Quit anywhere |

---

## How it works

Lock Dock writes to the `prefer-display-for-dock` key in `com.apple.dock` defaults, then restarts the Dock with `killall Dock` to apply the change immediately. No logout or system restart required.

```bash
defaults write com.apple.dock prefer-display-for-dock -string "Display Name"
killall Dock
```

---

## Manual install (from source)

If you prefer to clone and install manually:

```bash
git clone https://github.com/tabspacecoder/lockdock.git
cd lockdock
bash install.sh
```

---

## Uninstall

```bash
rm -rf ~/.lock-dock
sudo rm /usr/local/bin/lock-dock
```

---

## License

MIT © [tabspacecoder](https://github.com/tabspacecoder)