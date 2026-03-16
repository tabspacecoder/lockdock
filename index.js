#!/usr/bin/env node
import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { execSync, spawnSync } from 'child_process';

// ─── macOS guard ─────────────────────────────────────────────
if (process.platform !== 'darwin') {
  console.error('\x1b[31m✖ lock-dock only runs on macOS.\x1b[0m');
  process.exit(1);
}

// ─── How macOS controls which screen the Dock is on ──────────
//
// The Dock always lives on the PRIMARY display — the one with
// the menu bar (white bar in System Settings > Displays > Arrange).
//
// The ONLY reliable programmatic way to move the Dock is to use
// `displayplacer` (github.com/jakehilborn/displayplacer) to set
// the target display as origin (0,0), which makes it the primary.
//
// displayplacer reads the current layout with `displayplacer list`
// and re-applies it with the target display moved to origin (0,0).

function hasDisplayplacer() {
  try { execSync('which displayplacer', { encoding: 'utf8', timeout: 2000 }); return true; }
  catch { return false; }
}

function installDisplayplacer() {
  // Try Homebrew
  const hasBrew = (() => {
    try { execSync('which brew', { encoding: 'utf8', timeout: 2000 }); return true; }
    catch { return false; }
  })();
  if (!hasBrew) throw new Error('Homebrew not found. Install displayplacer manually:\n  brew install displayplacer');
  execSync('brew install displayplacer', { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
}

// Parse `displayplacer list` output into structured display objects
function parseDisplayplacerList() {
  const raw = execSync('displayplacer list', { encoding: 'utf8', timeout: 8000 });

  // Extract the command at the bottom of the output
  const cmdMatch = raw.match(/^displayplacer (.+)$/m);

  const displays = [];
  // Each display block looks like:
  //   Contextual screen id: <uuid>
  //   Persistent screen id: <uuid>
  //   Type: ...
  //   Resolution: WxH
  //   ...
  //   Origin: (x,y)
  //   ...
  const blocks = raw.split(/\n(?=Contextual screen id:)/);
  for (const block of blocks) {
    const idMatch     = block.match(/Persistent screen id:\s*(\S+)/);
    const ctxMatch    = block.match(/Contextual screen id:\s*(\S+)/);
    const resMatch    = block.match(/Resolution:\s*(\d+x\d+)/);
    const originMatch = block.match(/Origin:\s*\((-?\d+),(-?\d+)\)/);
    const modeMatch   = block.match(/Current mode:\s*(\d+)/);
    const nameMatch   = block.match(/Contextual screen id:[\s\S]*?(?:\n.*){0,3}\n.*?(?:Type|Resolution).*\n(?:.*\n)*?.*?(?:Name|localizedName):\s*(.+)/);

    if (!idMatch) continue;

    displays.push({
      persistentId: idMatch[1],
      contextualId: ctxMatch?.[1] ?? idMatch[1],
      resolution:   resMatch?.[1] ?? '?',
      originX:      originMatch ? parseInt(originMatch[1]) : 0,
      originY:      originMatch ? parseInt(originMatch[2]) : 0,
      mode:         modeMatch?.[1] ?? null,
      isPrimary:    originMatch ? (parseInt(originMatch[1]) === 0 && parseInt(originMatch[2]) === 0) : false,
      rawBlock:     block,
    });
  }

  return { displays, rawCommand: cmdMatch?.[1] ?? null };
}

// Extract per-screen arguments from the raw displayplacer command string
function parseDisplayplacerCommand(cmdStr) {
  if (!cmdStr) return [];
  // Each quoted arg is one screen config
  const args = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(cmdStr)) !== null) args.push(m[1]);
  return args;
}

function getDisplays() {
  if (hasDisplayplacer()) {
    try {
      const { displays } = parseDisplayplacerList();
      // Also get human-readable names via system_profiler
      let nameMap = {};
      try {
        const spRaw = execSync('system_profiler SPDisplaysDataType -json 2>/dev/null', {
          encoding: 'utf8', timeout: 8000
        });
        const spData = JSON.parse(spRaw);
        let idx = 0;
        for (const gpu of spData.SPDisplaysDataType ?? []) {
          for (const mon of gpu.spdisplays_ndrvs ?? []) {
            nameMap[idx] = mon._name ?? null;
            idx++;
          }
        }
      } catch {}

      return displays.map((d, i) => ({
        ...d,
        name: nameMap[i] ?? `Display ${i + 1}`,
      }));
    } catch {}
  }

  // Fallback: system_profiler only (no IDs — cannot switch)
  try {
    const raw = execSync('system_profiler SPDisplaysDataType -json 2>/dev/null', {
      encoding: 'utf8', timeout: 8000
    });
    const data = JSON.parse(raw);
    const displays = [];
    for (const gpu of data.SPDisplaysDataType ?? []) {
      for (const mon of gpu.spdisplays_ndrvs ?? []) {
        displays.push({
          persistentId: null,
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

function getCurrentPin() {
  try {
    const displays = getDisplays();
    const primary = displays.find(d => d.isPrimary);
    return primary ? primary.name : null;
  } catch {
    return null;
  }
}

function setDockDisplay(display) {
  if (!hasDisplayplacer()) {
    installDisplayplacer();
  }

  if (!display.persistentId) {
    throw new Error('Display ID not available. Make sure displayplacer is installed.');
  }

  // Strategy: re-run displayplacer with the target display at origin (0,0)
  // and all other displays shifted accordingly.
  // The screen at (0,0) becomes the primary — that's where the Dock goes.
  const { displays, rawCommand } = parseDisplayplacerList();
  const screenArgs = parseDisplayplacerCommand(rawCommand);

  if (screenArgs.length === 0) {
    throw new Error('Could not read display configuration from displayplacer.');
  }

  // Find the target display's current origin so we can shift all others
  const target = displays.find(d => d.persistentId === display.persistentId || d.contextualId === display.persistentId);
  if (!target) throw new Error(`Display "${display.name}" not found in displayplacer output.`);

  const shiftX = -target.originX;
  const shiftY = -target.originY;

  // Rebuild args: update each screen's origin by shifting
  const newArgs = screenArgs.map(arg => {
    const originMatch = arg.match(/origin:\((-?\d+),(-?\d+)\)/);
    if (!originMatch) return arg;
    const nx = parseInt(originMatch[1]) + shiftX;
    const ny = parseInt(originMatch[2]) + shiftY;
    return arg.replace(/origin:\(-?\d+,-?\d+\)/, `origin:(${nx},${ny})`);
  });

  // Build final command and execute
  const cmd = 'displayplacer ' + newArgs.map(a => `"${a}"`).join(' ');
  execSync(cmd, { encoding: 'utf8', timeout: 15000 });
}

function resetDockPin() {
  // Move Dock to first display or built-in display
  try {
    const displays = getDisplays();
    const builtin = displays.find(d =>
      d.name?.toLowerCase().includes('built-in') ||
      d.name?.toLowerCase().includes('retina') ||
      d.name?.toLowerCase().includes('macbook')
    ) ?? displays[0];
    if (builtin) setDockDisplay(builtin);
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
    const needsDisplayplacer = done.includes('displayplacer') || done.includes('Display ID');
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {isError ? (
          <>
            <Box marginBottom={1}><Text bold color={C.yellow}>  ⚠ Could not switch Dock</Text></Box>
            <Box paddingLeft={2} flexDirection="column">
              {needsDisplayplacer ? (
                <>
                  <Text color={C.white}>Lock Dock requires <Text color={C.accent} bold>displayplacer</Text> to work.</Text>
                  <Box marginTop={1}>
                    <Text color={C.muted}>Install it with Homebrew and try again:</Text>
                  </Box>
                  <Box marginTop={1} paddingLeft={1}>
                    <Text color={C.green}>brew install displayplacer</Text>
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