# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

No build step required. Open directly or serve locally:

```bash
open index.html                  # macOS — open directly
python3 -m http.server 8000      # then visit http://localhost:8000
```

## Architecture

Three files, no dependencies, no bundler:

- **`index.html`** — DOM structure: `<canvas id="board">` (300×600 px) for the playfield, `<canvas id="next-canvas">` (120×120 px) for the piece preview, and a shared overlay `div` used for both PAUSE and GAME OVER states.
- **`style.css`** — Dark/retro aesthetic. The overlay uses `backdrop-filter: blur` and is hidden via `.hidden { display: none }`.
- **`game.js`** — All game logic (~305 lines, `'use strict'`, no modules).

### Key data structures in `game.js`

- **`board`**: `ROWS × COLS` (20×10) array; `0` = empty, `1–7` = piece color index.
- **`current` / `next`**: `{ type, shape, x, y }` objects. `shape` is a 2D array of color indices.
- **`PIECES`**: piece definitions as square matrices; index matches `COLORS` (1-based, index 0 is `null`).

### Core function call chain

```
init() → spawn() → loop(ts) [rAF]
  loop: accumulates dt, drops piece or calls lockPiece()
  lockPiece: merge() → clearLines() → spawn()
  spawn: if collision on entry → endGame()
```

### Tunable constants (top of `game.js`)

| Constant | Default | Note |
|---|---|---|
| `COLS` / `ROWS` | 10 / 20 | Must match canvas `width`/`height` in `index.html` (`COLS×BLOCK` / `ROWS×BLOCK`) |
| `BLOCK` | 30 | Pixel size per cell |
| `COLORS` | 7 colors | Index 0 is `null`; indices 1–7 map to piece types |
| `LINE_SCORES` | `[0,100,300,500,800]` | Multiplied by current level |

Drop speed formula: `max(100, 1000 − (level − 1) × 90)` ms per row.
