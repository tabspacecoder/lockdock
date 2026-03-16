#!/usr/bin/env node
import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { execSync, spawnSync } from 'child_process';

// ─── macOS guard ─────────────────────────────────────────────
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
  try {
    execSync('which displayplacer', {
      encoding: 'utf8',
      timeout: 2000
    });
    return true;
  } catch {
    return false;
  }
}
function installDisplayplacer() {
  // Try Homebrew
  const hasBrew = (() => {
    try {
      execSync('which brew', {
        encoding: 'utf8',
        timeout: 2000
      });
      return true;
    } catch {
      return false;
    }
  })();
  if (!hasBrew) throw new Error('Homebrew not found. Install displayplacer manually:\n  brew install displayplacer');
  execSync('brew install displayplacer', {
    encoding: 'utf8',
    timeout: 120000,
    stdio: 'pipe'
  });
}

// Parse `displayplacer list` output into structured display objects
function parseDisplayplacerList() {
  const raw = execSync('displayplacer list', {
    encoding: 'utf8',
    timeout: 8000
  });

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
    const idMatch = block.match(/Persistent screen id:\s*(\S+)/);
    const ctxMatch = block.match(/Contextual screen id:\s*(\S+)/);
    const resMatch = block.match(/Resolution:\s*(\d+x\d+)/);
    const originMatch = block.match(/Origin:\s*\((-?\d+),(-?\d+)\)/);
    const modeMatch = block.match(/Current mode:\s*(\d+)/);
    const nameMatch = block.match(/Contextual screen id:[\s\S]*?(?:\n.*){0,3}\n.*?(?:Type|Resolution).*\n(?:.*\n)*?.*?(?:Name|localizedName):\s*(.+)/);
    if (!idMatch) continue;
    displays.push({
      persistentId: idMatch[1],
      contextualId: ctxMatch?.[1] ?? idMatch[1],
      resolution: resMatch?.[1] ?? '?',
      originX: originMatch ? parseInt(originMatch[1]) : 0,
      originY: originMatch ? parseInt(originMatch[2]) : 0,
      mode: modeMatch?.[1] ?? null,
      isPrimary: originMatch ? parseInt(originMatch[1]) === 0 && parseInt(originMatch[2]) === 0 : false,
      rawBlock: block
    });
  }
  return {
    displays,
    rawCommand: cmdMatch?.[1] ?? null
  };
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
      const {
        displays
      } = parseDisplayplacerList();
      // Also get human-readable names via system_profiler
      let nameMap = {};
      try {
        const spRaw = execSync('system_profiler SPDisplaysDataType -json 2>/dev/null', {
          encoding: 'utf8',
          timeout: 8000
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
        name: nameMap[i] ?? `Display ${i + 1}`
      }));
    } catch {}
  }

  // Fallback: system_profiler only (no IDs — cannot switch)
  try {
    const raw = execSync('system_profiler SPDisplaysDataType -json 2>/dev/null', {
      encoding: 'utf8',
      timeout: 8000
    });
    const data = JSON.parse(raw);
    const displays = [];
    for (const gpu of data.SPDisplaysDataType ?? []) {
      for (const mon of gpu.spdisplays_ndrvs ?? []) {
        displays.push({
          persistentId: null,
          name: mon._name ?? 'Unknown Display',
          resolution: mon.spdisplays_resolution ?? '?',
          isPrimary: mon.spdisplays_main === 'spdisplays_yes'
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
  const {
    displays,
    rawCommand
  } = parseDisplayplacerList();
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
  execSync(cmd, {
    encoding: 'utf8',
    timeout: 15000
  });
}
function resetDockPin() {
  // Move Dock to first display or built-in display
  try {
    const displays = getDisplays();
    const builtin = displays.find(d => d.name?.toLowerCase().includes('built-in') || d.name?.toLowerCase().includes('retina') || d.name?.toLowerCase().includes('macbook')) ?? displays[0];
    if (builtin) setDockDisplay(builtin);
  } catch {}
}

// ─── Theme ───────────────────────────────────────────────────
const C = {
  accent: '#FF6B35',
  dim: '#555566',
  muted: '#888899',
  white: '#F0EEF8',
  green: '#50FA7B',
  blue: '#8BE9FD',
  yellow: '#FFD580'
};

// ─── Shared Components ────────────────────────────────────────
const Divider = () => /*#__PURE__*/_jsx(Text, {
  color: C.dim,
  children: '─'.repeat(48)
});
const Header = () => /*#__PURE__*/_jsxs(Box, {
  flexDirection: "column",
  marginBottom: 1,
  children: [/*#__PURE__*/_jsx(Text, {
    bold: true,
    color: C.accent,
    children: "  ╔═══════════════════════════════════════════════════════════════════════╗"
  }), /*#__PURE__*/_jsxs(Text, {
    bold: true,
    color: C.accent,
    children: ["  ║ ", /*#__PURE__*/_jsx(Text, {
      color: C.white,
      children: "██╗      ██████╗  ██████╗██╗  ██╗   ██████╗  ██████╗  ██████╗██╗  ██╗"
    }), " ║"]
  }), /*#__PURE__*/_jsxs(Text, {
    bold: true,
    color: C.accent,
    children: ["  ║ ", /*#__PURE__*/_jsx(Text, {
      color: C.white,
      children: "██║     ██╔═══██╗██╔════╝██║ ██╔╝   ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝"
    }), " ║"]
  }), /*#__PURE__*/_jsxs(Text, {
    bold: true,
    color: C.accent,
    children: ["  ║ ", /*#__PURE__*/_jsx(Text, {
      color: C.white,
      children: "██║     ██║   ██║██║     █████╔╝    ██║  ██║██║   ██║██║     █████╔╝ "
    }), " ║"]
  }), /*#__PURE__*/_jsxs(Text, {
    bold: true,
    color: C.accent,
    children: ["  ║ ", /*#__PURE__*/_jsx(Text, {
      color: C.white,
      children: "██║     ██║   ██║██║     ██╔═██╗    ██║  ██║██║   ██║██║     ██╔═██╗ "
    }), " ║"]
  }), /*#__PURE__*/_jsxs(Text, {
    bold: true,
    color: C.accent,
    children: ["  ║ ", /*#__PURE__*/_jsx(Text, {
      color: C.white,
      children: "███████╗╚██████╔╝╚██████╗██║  ██╗   ██████╔╝╚██████╔╝╚██████╗██║  ██╗"
    }), " ║"]
  }), /*#__PURE__*/_jsxs(Text, {
    bold: true,
    color: C.accent,
    children: ["  ║ ", /*#__PURE__*/_jsx(Text, {
      color: C.white,
      children: "╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝   ╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝"
    }), " ║"]
  }), /*#__PURE__*/_jsxs(Text, {
    bold: true,
    color: C.accent,
    children: ["  ║ ", /*#__PURE__*/_jsx(Text, {
      color: C.muted,
      children: "Lock Dock • Pin your Dock to any monitor"
    }), "                              ║"]
  }), /*#__PURE__*/_jsx(Text, {
    bold: true,
    color: C.accent,
    children: "  ╚═══════════════════════════════════════════════════════════════════════╝"
  })]
});
const PinStatus = ({
  pin
}) => /*#__PURE__*/_jsxs(Box, {
  marginTop: 1,
  children: [/*#__PURE__*/_jsx(Text, {
    color: C.dim,
    children: "  Dock on: "
  }), pin ? /*#__PURE__*/_jsx(Text, {
    color: C.green,
    bold: true,
    children: pin
  }) : /*#__PURE__*/_jsx(Text, {
    color: C.muted,
    italic: true,
    children: "primary display (default)"
  })]
});
const Keys = ({
  keys
}) => /*#__PURE__*/_jsx(Box, {
  marginTop: 1,
  children: keys.map((k, i) => /*#__PURE__*/_jsxs(Text, {
    color: C.dim,
    children: ["  ", k]
  }, i))
});

// ─── HOME SCREEN ─────────────────────────────────────────────
const MENU = [{
  id: 'list',
  icon: '◈',
  label: 'List displays',
  desc: 'Show connected monitors'
}, {
  id: 'set',
  icon: '⊕',
  label: 'Lock Dock',
  desc: 'Pin Dock to a display'
}, {
  id: 'reset',
  icon: '↺',
  label: 'Reset / Unpin',
  desc: 'Dock follows cursor'
}, {
  id: 'status',
  icon: '◎',
  label: 'Status',
  desc: 'Current lock setting'
}, {
  id: 'quit',
  icon: '×',
  label: 'Quit',
  desc: ''
}];
function HomeScreen({
  onSelect,
  pin
}) {
  const [cursor, setCursor] = useState(0);
  const {
    exit
  } = useApp();
  useInput((input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(MENU.length - 1, c + 1));
    if (key.return || input === ' ') {
      const item = MENU[cursor];
      if (item.id === 'quit') exit();else onSelect(item.id);
    }
    if (input === 'q') exit();
  });
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 2,
    children: [/*#__PURE__*/_jsx(Header, {}), /*#__PURE__*/_jsx(Divider, {}), /*#__PURE__*/_jsx(Box, {
      flexDirection: "column",
      marginTop: 1,
      marginBottom: 1,
      children: MENU.map((item, i) => {
        const active = cursor === i;
        return /*#__PURE__*/_jsxs(Box, {
          paddingLeft: 1,
          children: [/*#__PURE__*/_jsx(Text, {
            color: active ? C.accent : C.dim,
            bold: true,
            children: active ? '▶ ' : '  '
          }), /*#__PURE__*/_jsxs(Text, {
            color: active ? C.accent : C.white,
            bold: active,
            children: [item.icon, " ", item.label]
          }), item.desc ? /*#__PURE__*/_jsxs(Text, {
            color: C.dim,
            children: ['  ', item.desc]
          }) : null]
        }, item.id);
      })
    }), /*#__PURE__*/_jsx(Divider, {}), /*#__PURE__*/_jsx(PinStatus, {
      pin: pin
    }), /*#__PURE__*/_jsx(Keys, {
      keys: ['↑↓ navigate', 'enter select', 'q quit']
    })]
  });
}

// ─── LIST SCREEN ─────────────────────────────────────────────
function ListScreen({
  onBack
}) {
  const [displays] = useState(() => getDisplays());
  useInput((_, key) => {
    if (key.escape || key.return) onBack();
  });
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 2,
    children: [/*#__PURE__*/_jsx(Box, {
      marginBottom: 1,
      children: /*#__PURE__*/_jsx(Text, {
        bold: true,
        color: C.accent,
        children: "  \u25C8 Connected Displays"
      })
    }), /*#__PURE__*/_jsx(Divider, {}), displays.length === 0 ? /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      children: /*#__PURE__*/_jsx(Text, {
        color: C.yellow,
        children: "  No displays found."
      })
    }) : displays.map((d, i) => /*#__PURE__*/_jsxs(Box, {
      flexDirection: "column",
      marginTop: 1,
      paddingLeft: 1,
      children: [/*#__PURE__*/_jsxs(Box, {
        children: [/*#__PURE__*/_jsxs(Text, {
          color: C.blue,
          bold: true,
          children: ["  [", i + 1, "] "]
        }), /*#__PURE__*/_jsx(Text, {
          color: C.white,
          bold: true,
          children: d.name
        }), d.isPrimary && /*#__PURE__*/_jsx(Text, {
          color: C.green,
          bold: true,
          children: "  \u2605 primary"
        }), d.retina && /*#__PURE__*/_jsx(Text, {
          color: C.muted,
          children: "  Retina"
        })]
      }), /*#__PURE__*/_jsxs(Text, {
        color: C.muted,
        children: ['       ', d.resolution]
      })]
    }, i)), /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      children: /*#__PURE__*/_jsx(Divider, {})
    }), /*#__PURE__*/_jsx(Keys, {
      keys: ['↵ / esc  back']
    })]
  });
}

// ─── SET SCREEN ──────────────────────────────────────────────
function SetScreen({
  onBack,
  onSuccess
}) {
  const [displays] = useState(() => getDisplays());
  const [cursor, setCursor] = useState(0);
  const [done, setDone] = useState(null);
  useInput((input, key) => {
    if (done) {
      if (key.return || key.escape) onBack();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
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
    return /*#__PURE__*/_jsxs(Box, {
      flexDirection: "column",
      paddingLeft: 2,
      children: [isError ? /*#__PURE__*/_jsxs(_Fragment, {
        children: [/*#__PURE__*/_jsx(Box, {
          marginBottom: 1,
          children: /*#__PURE__*/_jsx(Text, {
            bold: true,
            color: C.yellow,
            children: "  \u26A0 Could not switch Dock"
          })
        }), /*#__PURE__*/_jsx(Box, {
          paddingLeft: 2,
          flexDirection: "column",
          children: needsDisplayplacer ? /*#__PURE__*/_jsxs(_Fragment, {
            children: [/*#__PURE__*/_jsxs(Text, {
              color: C.white,
              children: ["Lock Dock requires ", /*#__PURE__*/_jsx(Text, {
                color: C.accent,
                bold: true,
                children: "displayplacer"
              }), " to work."]
            }), /*#__PURE__*/_jsx(Box, {
              marginTop: 1,
              children: /*#__PURE__*/_jsx(Text, {
                color: C.muted,
                children: "Install it with Homebrew and try again:"
              })
            }), /*#__PURE__*/_jsx(Box, {
              marginTop: 1,
              paddingLeft: 1,
              children: /*#__PURE__*/_jsx(Text, {
                color: C.green,
                children: "brew install displayplacer"
              })
            })]
          }) : /*#__PURE__*/_jsx(Text, {
            color: C.muted,
            children: done.replace('ERROR: ', '')
          })
        })]
      }) : /*#__PURE__*/_jsxs(_Fragment, {
        children: [/*#__PURE__*/_jsx(Box, {
          marginBottom: 1,
          children: /*#__PURE__*/_jsx(Text, {
            bold: true,
            color: C.green,
            children: "  \u2714 Dock moved!"
          })
        }), /*#__PURE__*/_jsxs(Box, {
          paddingLeft: 2,
          children: [/*#__PURE__*/_jsx(Text, {
            color: C.white,
            children: "Now on "
          }), /*#__PURE__*/_jsx(Text, {
            color: C.accent,
            bold: true,
            children: done
          })]
        }), /*#__PURE__*/_jsx(Box, {
          marginTop: 1,
          paddingLeft: 2,
          children: /*#__PURE__*/_jsx(Text, {
            color: C.muted,
            children: "The Dock is now on this display."
          })
        })]
      }), /*#__PURE__*/_jsx(Box, {
        marginTop: 1,
        children: /*#__PURE__*/_jsx(Divider, {})
      }), /*#__PURE__*/_jsx(Keys, {
        keys: ['↵ / esc  back']
      })]
    });
  }
  if (displays.length === 0) return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 2,
    children: [/*#__PURE__*/_jsx(Text, {
      color: C.yellow,
      children: "  No displays detected."
    }), /*#__PURE__*/_jsx(Keys, {
      keys: ['esc  back']
    })]
  });
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 2,
    children: [/*#__PURE__*/_jsx(Box, {
      marginBottom: 1,
      children: /*#__PURE__*/_jsx(Text, {
        bold: true,
        color: C.accent,
        children: "  \u2295 Choose a display to lock Dock to"
      })
    }), /*#__PURE__*/_jsx(Divider, {}), displays.map((d, i) => {
      const active = cursor === i;
      return /*#__PURE__*/_jsxs(Box, {
        marginTop: 1,
        paddingLeft: 1,
        children: [/*#__PURE__*/_jsx(Text, {
          color: active ? C.accent : C.dim,
          bold: true,
          children: active ? '▶ ' : '  '
        }), /*#__PURE__*/_jsxs(Text, {
          color: active ? C.accent : C.white,
          bold: active,
          children: ["[", i + 1, "] ", d.name]
        }), d.isPrimary && /*#__PURE__*/_jsx(Text, {
          color: C.green,
          children: "  \u2605"
        }), /*#__PURE__*/_jsxs(Text, {
          color: C.muted,
          children: ["  ", d.resolution]
        })]
      }, i);
    }), /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      children: /*#__PURE__*/_jsx(Divider, {})
    }), /*#__PURE__*/_jsx(Keys, {
      keys: ['↑↓ navigate', 'enter select', 'esc back']
    })]
  });
}

// ─── RESET SCREEN ────────────────────────────────────────────
function ResetScreen({
  onBack,
  onReset
}) {
  const [done, setDone] = useState(false);
  useInput((input, key) => {
    if (done) {
      if (key.return || key.escape) onBack();
      return;
    }
    if (input === 'y' || input === 'Y') {
      resetDockPin();
      onReset();
      setDone(true);
    }
    if (input === 'n' || input === 'N' || key.escape) onBack();
  });
  if (done) return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 2,
    children: [/*#__PURE__*/_jsx(Text, {
      bold: true,
      color: C.green,
      children: "  \u2714 Done. Dock moved to built-in display."
    }), /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      children: /*#__PURE__*/_jsx(Divider, {})
    }), /*#__PURE__*/_jsx(Keys, {
      keys: ['↵  back']
    })]
  });
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 2,
    children: [/*#__PURE__*/_jsx(Box, {
      marginBottom: 1,
      children: /*#__PURE__*/_jsx(Text, {
        bold: true,
        color: C.yellow,
        children: "  \u21BA Move Dock to built-in display?"
      })
    }), /*#__PURE__*/_jsx(Divider, {}), /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      paddingLeft: 2,
      children: /*#__PURE__*/_jsx(Text, {
        color: C.muted,
        children: "Moves the Dock back to your built-in / primary screen."
      })
    }), /*#__PURE__*/_jsxs(Box, {
      marginTop: 2,
      paddingLeft: 2,
      children: [/*#__PURE__*/_jsx(Text, {
        color: C.white,
        children: "Confirm?  "
      }), /*#__PURE__*/_jsx(Text, {
        color: C.green,
        bold: true,
        children: "[y]"
      }), /*#__PURE__*/_jsx(Text, {
        color: C.white,
        children: " yes    "
      }), /*#__PURE__*/_jsx(Text, {
        color: C.dim,
        children: "[n] / esc"
      }), /*#__PURE__*/_jsx(Text, {
        color: C.muted,
        children: " cancel"
      })]
    })]
  });
}

// ─── STATUS SCREEN ───────────────────────────────────────────
function StatusScreen({
  onBack,
  pin
}) {
  useInput((_, key) => {
    if (key.escape || key.return) onBack();
  });
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 2,
    children: [/*#__PURE__*/_jsx(Box, {
      marginBottom: 1,
      children: /*#__PURE__*/_jsx(Text, {
        bold: true,
        color: C.accent,
        children: "  \u25CE Lock Dock Status"
      })
    }), /*#__PURE__*/_jsx(Divider, {}), /*#__PURE__*/_jsxs(Box, {
      marginTop: 1,
      paddingLeft: 2,
      children: [/*#__PURE__*/_jsx(Text, {
        color: C.muted,
        children: "Current setting:  "
      }), pin ? /*#__PURE__*/_jsx(Text, {
        color: C.green,
        bold: true,
        children: pin
      }) : /*#__PURE__*/_jsx(Text, {
        color: C.muted,
        italic: true,
        children: "not pinned (follows cursor)"
      })]
    }), /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      children: /*#__PURE__*/_jsx(Divider, {})
    }), /*#__PURE__*/_jsx(Keys, {
      keys: ['↵ / esc  back']
    })]
  });
}

// ─── ROOT APP ────────────────────────────────────────────────
function App() {
  const [screen, setScreen] = useState('home');
  const [pin, setPin] = useState(() => getCurrentPin());
  const goHome = useCallback(() => setScreen('home'), []);
  if (screen === 'list') return /*#__PURE__*/_jsx(ListScreen, {
    onBack: goHome
  });
  if (screen === 'set') return /*#__PURE__*/_jsx(SetScreen, {
    onBack: goHome,
    onSuccess: n => {
      setPin(n);
    }
  });
  if (screen === 'reset') return /*#__PURE__*/_jsx(ResetScreen, {
    onBack: goHome,
    onReset: () => setPin(null)
  });
  if (screen === 'status') return /*#__PURE__*/_jsx(StatusScreen, {
    onBack: goHome,
    pin: pin
  });
  return /*#__PURE__*/_jsx(HomeScreen, {
    onSelect: setScreen,
    pin: pin
  });
}
render(/*#__PURE__*/_jsx(App, {}));