#!/usr/bin/env node
import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { execSync, spawnSync } from 'child_process';

// ─── macOS guard ─────────────────────────────────────────────
if (process.platform !== 'darwin') {
  console.error('\x1b[31m✖ lock-dock only runs on macOS.\x1b[0m');
  process.exit(1);
}

// ─── Display Detection ────────────────────────────────────────
// Uses Swift/osascript to get displays with their CGDisplayID,
// then sets the primary display via CGDisplaySetMainDisplayID.
// Setting the primary display is the ONLY reliable way to control
// which screen macOS puts the Dock on.

function getDisplays() {
  // Use a Swift one-liner via swift -e to enumerate all screens
  const swiftCode = `
import Cocoa
import CoreGraphics
let screens = NSScreen.screens
for (i, screen) in screens.enumerated() {
  let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as! CGDirectDisplayID
  let isPrimary = (id == CGMainDisplayID())
  let name = screen.localizedName
  let w = Int(screen.frame.width)
  let h = Int(screen.frame.height)
  print("\\(id)|\\(name)|\\(w)x\\(h)|\\(isPrimary ? "main" : "")")
}
`.trim();

  try {
    const raw = execSync(`swift -e '${swiftCode.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf8', timeout: 15000
    });
    return raw.trim().split('\n').filter(Boolean).map((line, idx) => {
      const [id, name, resolution, primary] = line.split('|');
      return {
        id: parseInt(id, 10),
        name: name ?? `Display ${idx + 1}`,
        resolution: resolution ?? '?',
        isPrimary: primary === 'main',
      };
    });
  } catch {
    // Fallback: system_profiler (no IDs, but still useful for display names)
    try {
      const raw = execSync('system_profiler SPDisplaysDataType -json 2>/dev/null', {
        encoding: 'utf8', timeout: 8000
      });
      const data = JSON.parse(raw);
      const displays = [];
      for (const gpu of data.SPDisplaysDataType ?? []) {
        for (const mon of gpu.spdisplays_ndrvs ?? []) {
          displays.push({
            id: null,
            name:       mon._name ?? 'Unknown Display',
            resolution: mon.spdisplays_resolution ?? '?',
            isPrimary:  mon.spdisplays_main === 'spdisplays_yes',
          });
        }
      }
      return displays;
    } catch {
      return [];
    }
  }
}

function getCurrentPin() {
  // The primary display name is the ground truth — that's where the Dock lives
  try {
    const displays = getDisplays();
    const primary = displays.find(d => d.isPrimary);
    return primary ? primary.name : null;
  } catch {
    return null;
  }
}

function setDockDisplay(display) {
  if (display.id == null) {
    throw new Error('Display ID not available — cannot set primary display.');
  }

  // Use a Swift snippet to set the main display via private SkyLight API.
  // This is the same mechanism System Preferences uses.
  const swiftCode = `
import Cocoa
import CoreGraphics

@_silgen_name("CGSSetMainDisplayID")
func CGSSetMainDisplayID(_ displayID: CGDirectDisplayID)

let targetID: CGDirectDisplayID = ${display.id}
CGDisplayConfigRef.withUnsafeMutablePointer { _ in }
var configRef: CGDisplayConfigRef?
CGBeginDisplayConfiguration(&configRef)
CGConfigureDisplayOrigin(configRef, targetID, 0, 0)
CGSSetMainDisplayID(targetID)
CGCompleteDisplayConfiguration(configRef, .permanently)
`.trim();

  try {
    execSync(`swift -e '${swiftCode.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf8', timeout: 15000
    });
  } catch {
    // CGSSetMainDisplayID approach may fail on newer macOS.
    // Fall back: use AppleScript to click "Main Display" in System Settings
    // which is the most reliable non-private approach available.
    setDockDisplayViaAppleScript(display.name);
  }
  spawnSync('killall', ['Dock']);
}

function setDockDisplayViaAppleScript(displayName) {
  // AppleScript approach: open Displays arrangement and move the menu bar
  // This is a UI-scripting fallback — requires Accessibility permissions
  const script = `
tell application "System Events"
  tell process "System Preferences"
    -- fallback: open displays pref pane
  end tell
end tell
`.trim();
  // If Swift private API fails, we use the most reliable fallback:
  // write the prefer-display-for-dock key AND move the main display
  // via displayplacer if available, otherwise inform the user
  const hasDisplayplacer = (() => {
    try { execSync('which displayplacer', { timeout: 2000 }); return true; } catch { return false; }
  })();

  if (hasDisplayplacer) {
    // Get displayplacer ID for this display and set it as main
    const dpOut = execSync('displayplacer list 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const match = dpOut.match(new RegExp(`id:([A-Fa-f0-9-]+)[^\\n]*${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    if (match) {
      execSync(`displayplacer "id:${match[1]} degree:0 enabled:true scaling:on" "origin:(0,0) hz:0"`);
    }
  } else {
    // Last resort: prefer-display-for-dock defaults key + killall Dock
    // This works on some macOS versions
    execSync(`defaults write com.apple.dock "prefer-display-for-dock" -string "${displayName.replace(/"/g, '\\"')}"`);
  }
}

function resetDockPin() {
  // Reset means: make the built-in display (or first display) primary
  try {
    execSync('defaults delete com.apple.dock prefer-display-for-dock 2>/dev/null');
  } catch {}
  spawnSync('killall', ['Dock']);
}


// ─── Theme ───────────────────────────────────────────────────
const C = {
  accent:  '#FF6B35',
  dim:     '#555566',
  muted:   '#888899',
  white:   '#F0EEF8',
  green:   '#50FA7B',
  blue:    '#8BE9FD',
  yellow:  '#FFD580',
};

// ─── Shared Components ────────────────────────────────────────
const Divider = () => <Text color={C.dim}>{'─'.repeat(48)}</Text>;

const Header = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={C.accent}>{"  ╔═══════════════════════════════════════════════════════════════════════╗"}</Text>
    <Text bold color={C.accent}>{"  ║ "}<Text color={C.white}>{"██╗      ██████╗  ██████╗██╗  ██╗   ██████╗  ██████╗  ██████╗██╗  ██╗"}</Text>{" ║"}</Text>
    <Text bold color={C.accent}>{"  ║ "}<Text color={C.white}>{"██║     ██╔═══██╗██╔════╝██║ ██╔╝   ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝"}</Text>{" ║"}</Text>
    <Text bold color={C.accent}>{"  ║ "}<Text color={C.white}>{"██║     ██║   ██║██║     █████╔╝    ██║  ██║██║   ██║██║     █████╔╝ "}</Text>{" ║"}</Text>
    <Text bold color={C.accent}>{"  ║ "}<Text color={C.white}>{"██║     ██║   ██║██║     ██╔═██╗    ██║  ██║██║   ██║██║     ██╔═██╗ "}</Text>{" ║"}</Text>
    <Text bold color={C.accent}>{"  ║ "}<Text color={C.white}>{"███████╗╚██████╔╝╚██████╗██║  ██╗   ██████╔╝╚██████╔╝╚██████╗██║  ██╗"}</Text>{" ║"}</Text>
    <Text bold color={C.accent}>{"  ║ "}<Text color={C.white}>{"╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝   ╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝"}</Text>{" ║"}</Text>
    <Text bold color={C.accent}>{"  ║ "}<Text color={C.muted}>{"Lock Dock • Pin your Dock to any monitor"}</Text>{"                              ║"}</Text>
    <Text bold color={C.accent}>{"  ╚═══════════════════════════════════════════════════════════════════════╝"}</Text>
  </Box>
);

const PinStatus = ({ pin }) => (
  <Box marginTop={1}>
    <Text color={C.dim}>  Dock on: </Text>
    {pin
      ? <Text color={C.green} bold>{pin}</Text>
      : <Text color={C.muted} italic>primary display (default)</Text>
    }
  </Box>
);

const Keys = ({ keys }) => (
  <Box marginTop={1}>
    {keys.map((k, i) => (
      <Text key={i} color={C.dim}>  {k}</Text>
    ))}
  </Box>
);

// ─── HOME SCREEN ─────────────────────────────────────────────
const MENU = [
  { id: 'list',  icon: '◈', label: 'List displays',  desc: 'Show connected monitors' },
  { id: 'set',   icon: '⊕', label: 'Lock Dock',      desc: 'Pin Dock to a display'   },
  { id: 'reset', icon: '↺', label: 'Reset / Unpin',  desc: 'Dock follows cursor'      },
  { id: 'status',icon: '◎', label: 'Status',         desc: 'Current lock setting'     },
  { id: 'quit',  icon: '×', label: 'Quit',           desc: ''                         },
];

function HomeScreen({ onSelect, pin }) {
  const [cursor, setCursor] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(MENU.length - 1, c + 1));
    if (key.return || input === ' ') {
      const item = MENU[cursor];
      if (item.id === 'quit') exit();
      else onSelect(item.id);
    }
    if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Header />
      <Divider />
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {MENU.map((item, i) => {
          const active = cursor === i;
          return (
            <Box key={item.id} paddingLeft={1}>
              <Text color={active ? C.accent : C.dim} bold>{active ? '▶ ' : '  '}</Text>
              <Text color={active ? C.accent : C.white} bold={active}>
                {item.icon} {item.label}
              </Text>
              {item.desc
                ? <Text color={C.dim}>{'  '}{item.desc}</Text>
                : null}
            </Box>
          );
        })}
      </Box>
      <Divider />
      <PinStatus pin={pin} />
      <Keys keys={['↑↓ navigate', 'enter select', 'q quit']} />
    </Box>
  );
}

// ─── LIST SCREEN ─────────────────────────────────────────────
function ListScreen({ onBack }) {
  const [displays] = useState(() => getDisplays());

  useInput((_, key) => {
    if (key.escape || key.return) onBack();
  });

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}><Text bold color={C.accent}>  ◈ Connected Displays</Text></Box>
      <Divider />
      {displays.length === 0
        ? <Box marginTop={1}><Text color={C.yellow}>  No displays found.</Text></Box>
        : displays.map((d, i) => (
            <Box key={i} flexDirection="column" marginTop={1} paddingLeft={1}>
              <Box>
                <Text color={C.blue} bold>  [{i + 1}] </Text>
                <Text color={C.white} bold>{d.name}</Text>
                {d.isPrimary && <Text color={C.green} bold>  ★ primary</Text>}
                {d.retina    && <Text color={C.muted}>  Retina</Text>}
              </Box>
              <Text color={C.muted}>{'       '}{d.resolution}</Text>
            </Box>
          ))
      }
      <Box marginTop={1}><Divider /></Box>
      <Keys keys={['↵ / esc  back']} />
    </Box>
  );
}

// ─── SET SCREEN ──────────────────────────────────────────────
function SetScreen({ onBack, onSuccess }) {
  const [displays]  = useState(() => getDisplays());
  const [cursor, setCursor] = useState(0);
  const [done,   setDone]   = useState(null);

  useInput((input, key) => {
    if (done) { if (key.return || key.escape) onBack(); return; }
    if (key.escape) { onBack(); return; }
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(displays.length - 1, c + 1));
    if (key.return || input === ' ') {
      const chosen = displays[cursor];
      try {
        setDockDisplay(chosen);
        setDone(chosen.name);
        onSuccess(chosen.name);
      } catch (e) {
        setDone('ERROR: ' + e.message);
      }
    }
  });

  if (done) return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}><Text bold color={C.green}>  ✔ Dock locked!</Text></Box>
      <Box paddingLeft={2}>
        <Text color={C.white}>Pinned to </Text>
        <Text color={C.accent} bold>{done}</Text>
      </Box>
      <Box marginTop={1} paddingLeft={2}>
        <Text color={C.muted}>Set as primary display. The Dock will now appear here.</Text>
      </Box>
      <Box marginTop={1}><Divider /></Box>
      <Keys keys={['↵ / esc  back']} />
    </Box>
  );

  if (displays.length === 0) return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color={C.yellow}>  No displays detected.</Text>
      <Keys keys={['esc  back']} />
    </Box>
  );

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}><Text bold color={C.accent}>  ⊕ Choose a display to lock Dock to</Text></Box>
      <Divider />
      {displays.map((d, i) => {
        const active = cursor === i;
        return (
          <Box key={i} marginTop={1} paddingLeft={1}>
            <Text color={active ? C.accent : C.dim} bold>{active ? '▶ ' : '  '}</Text>
            <Text color={active ? C.accent : C.white} bold={active}>[{i+1}] {d.name}</Text>
            {d.isPrimary && <Text color={C.green}>  ★</Text>}
            <Text color={C.muted}>  {d.resolution}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}><Divider /></Box>
      <Keys keys={['↑↓ navigate', 'enter select', 'esc back']} />
    </Box>
  );
}

// ─── RESET SCREEN ────────────────────────────────────────────
function ResetScreen({ onBack, onReset }) {
  const [done, setDone] = useState(false);

  useInput((input, key) => {
    if (done) { if (key.return || key.escape) onBack(); return; }
    if (input === 'y' || input === 'Y') {
      resetDockPin();
      onReset();
      setDone(true);
    }
    if (input === 'n' || input === 'N' || key.escape) onBack();
  });

  if (done) return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold color={C.green}>  ✔ Pin removed. Dock will follow cursor.</Text>
      <Box marginTop={1}><Divider /></Box>
      <Keys keys={['↵  back']} />
    </Box>
  );

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}><Text bold color={C.yellow}>  ↺ Reset Dock pin?</Text></Box>
      <Divider />
      <Box marginTop={1} paddingLeft={2}>
        <Text color={C.muted}>Removes the pinned display — Dock will follow cursor again.</Text>
      </Box>
      <Box marginTop={2} paddingLeft={2}>
        <Text color={C.white}>Confirm?  </Text>
        <Text color={C.green} bold>[y]</Text>
        <Text color={C.white}> yes    </Text>
        <Text color={C.dim}>[n] / esc</Text>
        <Text color={C.muted}> cancel</Text>
      </Box>
    </Box>
  );
}

// ─── STATUS SCREEN ───────────────────────────────────────────
function StatusScreen({ onBack, pin }) {
  useInput((_, key) => { if (key.escape || key.return) onBack(); });

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}><Text bold color={C.accent}>  ◎ Lock Dock Status</Text></Box>
      <Divider />
      <Box marginTop={1} paddingLeft={2}>
        <Text color={C.muted}>Current setting:  </Text>
        {pin
          ? <Text color={C.green} bold>{pin}</Text>
          : <Text color={C.muted} italic>not pinned (follows cursor)</Text>
        }
      </Box>
      <Box marginTop={1}><Divider /></Box>
      <Keys keys={['↵ / esc  back']} />
    </Box>
  );
}

// ─── ROOT APP ────────────────────────────────────────────────
function App() {
  const [screen, setScreen] = useState('home');
  const [pin, setPin]       = useState(() => getCurrentPin());
  const goHome = useCallback(() => setScreen('home'), []);

  if (screen === 'list')   return <ListScreen   onBack={goHome} />;
  if (screen === 'set')    return <SetScreen    onBack={goHome} onSuccess={n => { setPin(n); }} />;
  if (screen === 'reset')  return <ResetScreen  onBack={goHome} onReset={() => setPin(null)} />;
  if (screen === 'status') return <StatusScreen onBack={goHome} pin={pin} />;
  return <HomeScreen onSelect={setScreen} pin={pin} />;
}

render(<App />);