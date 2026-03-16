#!/usr/bin/env node
import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { execSync, spawnSync } from 'child_process';

// ─── macOS guard ─────────────────────────────────────────────
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
if (process.platform !== 'darwin') {
  console.error('\x1b[31m✖ lock-dock only runs on macOS.\x1b[0m');
  process.exit(1);
}

// ─── Display Detection ────────────────────────────────────────
function getDisplays() {
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
          name: mon._name ?? 'Unknown Display',
          resolution: mon.spdisplays_resolution ?? '?',
          isPrimary: mon.spdisplays_main === 'spdisplays_yes',
          retina: !!mon.spdisplays_pixelresolution
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
    return execSync('defaults read com.apple.dock prefer-display-for-dock 2>/dev/null', {
      encoding: 'utf8',
      timeout: 2000
    }).trim();
  } catch {
    return null;
  }
}
function setDockDisplay(name) {
  execSync(`defaults write com.apple.dock "prefer-display-for-dock" -string "${name.replace(/"/g, '\\"')}"`);
  spawnSync('killall', ['Dock']);
}
function resetDockPin() {
  try {
    execSync('defaults delete com.apple.dock prefer-display-for-dock 2>/dev/null');
  } catch {}
  spawnSync('killall', ['Dock']);
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
    children: "  Dock pinned to: "
  }), pin ? /*#__PURE__*/_jsx(Text, {
    color: C.green,
    bold: true,
    children: pin
  }) : /*#__PURE__*/_jsx(Text, {
    color: C.muted,
    italic: true,
    children: "not pinned (follows cursor)"
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
        setDockDisplay(chosen.name);
        setDone(chosen.name);
        onSuccess(chosen.name);
      } catch (e) {
        setDone('ERROR: ' + e.message);
      }
    }
  });
  if (done) return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 2,
    children: [/*#__PURE__*/_jsx(Box, {
      marginBottom: 1,
      children: /*#__PURE__*/_jsx(Text, {
        bold: true,
        color: C.green,
        children: "  \u2714 Dock locked!"
      })
    }), /*#__PURE__*/_jsxs(Box, {
      paddingLeft: 2,
      children: [/*#__PURE__*/_jsx(Text, {
        color: C.white,
        children: "Pinned to "
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
        children: "Dock restarted. It will now stay on this display."
      })
    }), /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      children: /*#__PURE__*/_jsx(Divider, {})
    }), /*#__PURE__*/_jsx(Keys, {
      keys: ['↵ / esc  back']
    })]
  });
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
      children: "  \u2714 Pin removed. Dock will follow cursor."
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
        children: "  \u21BA Reset Dock pin?"
      })
    }), /*#__PURE__*/_jsx(Divider, {}), /*#__PURE__*/_jsx(Box, {
      marginTop: 1,
      paddingLeft: 2,
      children: /*#__PURE__*/_jsx(Text, {
        color: C.muted,
        children: "Removes the pinned display \u2014 Dock will follow cursor again."
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