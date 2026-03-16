#!/usr/bin/env node
import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { execSync, spawnSync } from 'child_process';

// ─── macOS guard ─────────────────────────────────────────────
if (process.platform !== 'darwin') {
  console.error('\x1b[31m✖ lock-dock only runs on macOS.\x1b[0m');
  process.exit(1);
}

// ─── How macOS moves the Dock ─────────────────────────────────
//
// macOS moves the Dock to whichever screen the mouse cursor
// "pushes against" the bottom edge of. There is no public API,
// no defaults key, and no private API that reliably does this.
//
// The correct approach is to SIMULATE the mouse gesture:
//   1. Move cursor to the bottom centre of the target screen
//   2. Keep nudging it downward past the edge
//   3. macOS detects this and moves the Dock
//   4. Restore the cursor to its original position
//
// Key insight: CGEvent uses CGDisplayBounds coordinates (top-left
// origin, Y increases downward). The BOTTOM of a screen in CG
// coordinates is: bounds.origin.y + bounds.height

// Write a Swift script to a temp file and run it
function runSwift(code) {
  const tmp = '/tmp/_lockdock_' + Date.now() + '.swift';
  require('fs').writeFileSync(tmp, code);
  try {
    const result = execSync(`swift "${tmp}"`, {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin' }
    });
    return result.trim();
  } finally {
    try { require('fs').unlinkSync(tmp); } catch {}
  }
}

function getDisplays() {
  const code = `
import Cocoa
import CoreGraphics

let screens = NSScreen.screens
for (i, screen) in screens.enumerated() {
    let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as! CGDirectDisplayID
    let bounds = CGDisplayBounds(id)
    let isPrimary = (id == CGMainDisplayID())
    let name = screen.localizedName
    let w = Int(screen.frame.width)
    let h = Int(screen.frame.height)
    // CG bounds (top-left origin, Y down)
    let bx = Int(bounds.origin.x)
    let by = Int(bounds.origin.y)
    let bw = Int(bounds.width)
    let bh = Int(bounds.height)
    print("\\(id)|\\(name)|\\(w)x\\(h)|\\(isPrimary ? "1" : "0")|\\(bx)|\\(by)|\\(bw)|\\(bh)")
}
`;
  try {
    const raw = runSwift(code);
    return raw.split('\n').filter(Boolean).map((line, idx) => {
      const p = line.split('|');
      return {
        id:         parseInt(p[0], 10),
        name:       p[1] ?? `Display ${idx + 1}`,
        resolution: p[2] ?? '?',
        isPrimary:  p[3] === '1',
        cgX:        parseInt(p[4], 10),
        cgY:        parseInt(p[5], 10),
        cgW:        parseInt(p[6], 10),
        cgH:        parseInt(p[7], 10),
      };
    });
  } catch (e) {
    // Swift failed — fall back to system_profiler (display info only)
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
    } catch { return []; }
  }
}

function getCurrentPin() {
  try {
    const displays = getDisplays();
    const primary = displays.find(d => d.isPrimary);
    return primary ? primary.name : null;
  } catch { return null; }
}

function setDockDisplay(display) {
  if (display.cgX == null || display.cgW == null) {
    throw new Error('Cannot get display coordinates. Make sure Xcode Command Line Tools are installed:\n  xcode-select --install');
  }

  // Centre-bottom of target screen in CG coordinates
  const centreX = display.cgX + Math.floor(display.cgW / 2);
  // In CG coords: Y increases downward. Bottom of screen = cgY + cgH.
  // We move to just inside the bottom, then past it.
  const insideY = display.cgY + display.cgH - 2;  // 2px from bottom
  const outsideY = display.cgY + display.cgH + 20; // 20px past bottom edge

  const code = `
import Cocoa
import CoreGraphics

func warp(_ x: CGFloat, _ y: CGFloat) {
    // CGWarpMouseCursorPosition moves the cursor without generating events
    // CGDisplayMoveCursorToPoint also works
    let pt = CGPoint(x: x, y: y)
    CGWarpMouseCursorPosition(pt)
    // Also post a real mouse-moved event so the Dock notices
    if let src = CGEventSource(stateID: .combinedSessionState) {
        let ev = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: pt, mouseButton: .left)
        ev?.post(tap: .cghidEventTap)
    }
    Thread.sleep(forTimeInterval: 0.08)
}

// Save current position
let saved = NSEvent.mouseLocation
// NSEvent uses bottom-left origin; convert to CG (top-left) coords
let screenH = CGDisplayBounds(CGMainDisplayID()).height
let savedCG = CGPoint(x: saved.x, y: screenH - saved.y)

// Move to bottom-centre of target screen, inside edge
warp(${centreX}, ${insideY})
// Nudge past the bottom edge — this triggers the Dock to move
warp(${centreX}, ${outsideY})
Thread.sleep(forTimeInterval: 0.4)
// Move back inside so Dock settles
warp(${centreX}, ${insideY})
Thread.sleep(forTimeInterval: 0.3)

// Restore original cursor position
warp(savedCG.x, savedCG.y)
`;

  runSwift(code);
}

function resetDockPin() {
  try {
    const displays = getDisplays();
    // Prefer built-in MacBook screen, else first display
    const target = displays.find(d =>
      d.name?.toLowerCase().includes('built-in') ||
      d.name?.toLowerCase().includes('retina') ||
      d.name?.toLowerCase().includes('macbook')
    ) ?? displays[0];
    if (target) setDockDisplay(target);
  } catch {}
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

  if (done) {
    const isError = done.startsWith('ERROR:');
    const needsXcode = done.includes('xcode-select') || done.includes('coordinates');
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {isError ? (
          <>
            <Box marginBottom={1}><Text bold color={C.yellow}>  ⚠ Could not switch Dock</Text></Box>
            <Box paddingLeft={2} flexDirection="column">
              {needsXcode ? (
                <>
                  <Text color={C.white}>Lock Dock needs Xcode Command Line Tools.</Text>
                  <Box marginTop={1}>
                    <Text color={C.muted}>Install them and try again:</Text>
                  </Box>
                  <Box marginTop={1} paddingLeft={1}>
                    <Text color={C.green}>xcode-select --install</Text>
                  </Box>
                </>
              ) : (
                <Text color={C.muted}>{done.replace('ERROR: ', '')}</Text>
              )}
            </Box>
          </>
        ) : (
          <>
            <Box marginBottom={1}><Text bold color={C.green}>  ✔ Dock moved!</Text></Box>
            <Box paddingLeft={2}>
              <Text color={C.white}>Now on </Text>
              <Text color={C.accent} bold>{done}</Text>
            </Box>
            <Box marginTop={1} paddingLeft={2}>
              <Text color={C.muted}>The Dock is now on this display.</Text>
            </Box>
          </>
        )}
        <Box marginTop={1}><Divider /></Box>
        <Keys keys={['↵ / esc  back']} />
      </Box>
    );
  }

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
      <Text bold color={C.green}>  ✔ Done. Dock moved to built-in display.</Text>
      <Box marginTop={1}><Divider /></Box>
      <Keys keys={['↵  back']} />
    </Box>
  );

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}><Text bold color={C.yellow}>  ↺ Move Dock to built-in display?</Text></Box>
      <Divider />
      <Box marginTop={1} paddingLeft={2}>
        <Text color={C.muted}>Moves the Dock back to your built-in / primary screen.</Text>
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