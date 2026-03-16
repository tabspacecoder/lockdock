# 🖥 lock-dock

**Interactive TUI to lock your macOS Dock to a specific monitor.**  
Built with [Ink](https://github.com/vadimdemedes/ink) — the same React-for-CLIs framework used by Claude Code.

---

## Requirements

- macOS 10.15 Catalina or later  
- Node.js 18+ — [nodejs.org](https://nodejs.org)

---

## Install

```bash
# 1. Unzip and enter the folder
unzip lock-dock.zip && cd lock-dock

# 2. Run the installer (adds `lock-dock` to /usr/local/bin)
bash install.sh
```

That's it. The installer copies the app to `~/.lock-dock` and creates a global `lock-dock` command.

---

## Usage

Just run:

```
lock-dock
```

You'll get a full interactive TUI with arrow-key navigation:

```
  ╔══════════════════════════════════╗
  ║  🖥  lock-dock                   ║
  ║  Pin your Dock to any monitor    ║
  ╚══════════════════════════════════╝

  ▶ ◈ List displays       Show connected monitors
    ⊕ Lock Dock            Pin Dock to a display
    ↺ Reset / Unpin        Let Dock follow cursor
    ◎ Status               Current lock setting
    × Quit

  ↑↓ navigate   enter select   q quit
```

### Screens

| Screen | What it does |
|---|---|
| **List displays** | Shows all connected monitors, resolution, and which is primary |
| **Lock Dock** | Arrow-key picker — select a monitor, Dock restarts instantly |
| **Reset / Unpin** | Confirms then removes the pin (back to macOS default) |
| **Status** | Shows the currently pinned display name |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate menu |
| `Enter` / `Space` | Select |
| `Esc` | Go back |
| `q` | Quit anywhere |

---

## How it works

lock-dock writes to the `prefer-display-for-dock` key in `com.apple.dock` defaults,  
then restarts the Dock with `killall Dock` to apply the change immediately.  
No logout or restart required.

---

## Uninstall

```bash
rm -rf ~/.lock-dock
sudo rm /usr/local/bin/lock-dock
```
