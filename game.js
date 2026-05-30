'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
  '#f5f5f5', // WILD - white
  '#4db6ac', // + pentomino - teal
  '#f06292', // U pentomino - pink
  '#9575cd', // Y pentomino - violet
  '#fff176', // single reward - gold
  '#ff8a65', // 3×3 hollow - coral
];

const WILD = 8;

const SPECIAL_PIECES = {
  plus:   [[0,9,0],[9,9,9],[0,9,0]],
  u:      [[10,0,10],[10,10,10]],
  y:      [[0,11],[11,11],[0,11],[0,11]],
  hollow: [[13,13,13],[13,0,13],[13,13,13]],
};
const SPECIAL_KINDS = ['plus', 'u', 'y', 'hollow'];
const SINGLE_COLOR = 12;
const SPECIAL_CHANCE = 0.12;
const HOLLOW_BONUS = 200; // × level al colocar la 3×3 hueca

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const POWER_UPS = ['bomb', 'laser', 'dye', 'gravity', 'freeze'];
const POWERUP_ICONS = { bomb: '💣', laser: '⚡', dye: '🎨', gravity: '⬇', freeze: '❄' };
const POWERUP_COLORS = { bomb: '#e57373', laser: '#ffd54f', dye: '#ba68c8', gravity: '#81c784', freeze: '#4dd0e1' };
const FREEZE_MS = 5000;
const POWERUP_EVERY = 5;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pendingPowerUp, lastPowerUpMilestone, frozenUntil, pendingReward;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPowerUp() {
  const kind = POWER_UPS[Math.floor(Math.random() * POWER_UPS.length)];
  return { type: -1, powerUp: kind, shape: [[1]], x: Math.floor(COLS / 2), y: 0 };
}

function makeSpecialPiece(kind) {
  const shape = SPECIAL_PIECES[kind].map(row => [...row]);
  return { type: -2, special: kind, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomSpecialPiece() {
  const kind = SPECIAL_KINDS[Math.floor(Math.random() * SPECIAL_KINDS.length)];
  return makeSpecialPiece(kind);
}

function singlePiece() {
  return { type: -3, special: 'single', shape: [[SINGLE_COLOR]], x: Math.floor(COLS / 2), y: 0 };
}

function makeNextPiece() {
  if (pendingPowerUp) {
    pendingPowerUp = false;
    return randomPowerUp();
  }
  if (pendingReward) {
    pendingReward = false;
    return singlePiece();
  }
  if (Math.random() < SPECIAL_CHANCE) return randomSpecialPiece();
  return randomPiece();
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  if (current.powerUp) return; // 1×1 blocks don't rotate
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let totalCleared = 0;

  // cascade loop: keep clearing while full rows exist
  while (true) {
    const fullRows = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r].every(v => v !== 0)) fullRows.push(r);
    }
    if (fullRows.length === 0) break;

    // spread wilds adjacent (ortho) to full rows
    const wildsToClear = new Set();
    for (const fr of fullRows) {
      for (let c = 0; c < COLS; c++) {
        const neighbors = [[fr - 1, c], [fr + 1, c], [fr, c - 1], [fr, c + 1]];
        for (const [nr, nc] of neighbors) {
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] === WILD) {
            wildsToClear.add(`${nr},${nc}`);
          }
        }
      }
    }
    for (const key of wildsToClear) {
      const [r, c] = key.split(',').map(Number);
      board[r][c] = 0;
    }

    // remove full rows (highest index first so splice offsets don't interfere)
    const sorted = [...fullRows].sort((a, b) => b - a);
    for (const r of sorted) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
    }
    totalCleared += fullRows.length;
  }

  if (totalCleared) {
    lines += totalCleared;
    score += (LINE_SCORES[Math.min(totalCleared, 4)] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();

    // check power-up milestone
    const milestone = Math.floor(lines / POWERUP_EVERY);
    if (milestone > lastPowerUpMilestone) {
      lastPowerUpMilestone = milestone;
      pendingPowerUp = true;
    }

    // Tetris (4+ líneas) → recompensa: pieza single
    if (totalCleared >= 4) pendingReward = true;
  }
}

function applyDye() {
  const counts = new Array(8).fill(0);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (v >= 1 && v <= 7) counts[v]++;
    }
  let maxColor = 0, maxCount = 0;
  for (let i = 1; i <= 7; i++) {
    if (counts[i] > maxCount) { maxCount = counts[i]; maxColor = i; }
  }
  if (!maxColor) return;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] === maxColor) board[r][c] = WILD;
}

function applyGravity() {
  for (let c = 0; c < COLS; c++) {
    const blocks = [];
    for (let r = 0; r < ROWS; r++)
      if (board[r][c]) blocks.push(board[r][c]);
    for (let r = 0; r < ROWS; r++)
      board[r][c] = r < ROWS - blocks.length ? 0 : blocks[r - (ROWS - blocks.length)];
  }
}

function applyPowerUp(piece) {
  const cx = piece.x, cy = piece.y;
  switch (piece.powerUp) {
    case 'bomb':
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = cy + dr, nc = cx + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) board[nr][nc] = 0;
        }
      break;
    case 'laser':
      for (let c = 0; c < COLS; c++) board[cy][c] = 0;
      for (let r = 0; r < ROWS; r++) board[r][cx] = 0;
      break;
    case 'dye':
      applyDye();
      break;
    case 'gravity':
      applyGravity();
      break;
    case 'freeze':
      frozenUntil = performance.now() + FREEZE_MS;
      break;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.powerUp) {
    applyPowerUp(current);
    clearLines();
    spawn();
    return;
  }
  merge();
  if (current.special === 'hollow') {
    score += HOLLOW_BONUS * level;
    updateHUD();
  }
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = makeNextPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  // wild marker
  if (colorIndex === WILD) {
    context.fillStyle = 'rgba(100,180,255,0.4)';
    context.font = `${Math.floor(size * 0.45)}px serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('✦', x * size + size / 2, y * size + size / 2);
  }
  context.globalAlpha = 1;
}

function drawPowerUpBlock(context, x, y, kind, size, alpha) {
  context.globalAlpha = alpha ?? 1;
  const bg = POWERUP_COLORS[kind] || '#ffffff';
  context.fillStyle = bg;
  const rx = x * size + 2, ry = y * size + 2, rw = size - 4, rh = size - 4;
  context.beginPath();
  context.roundRect(rx, ry, rw, rh, 4);
  context.fill();
  context.font = `${Math.floor(size * 0.55)}px serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(POWERUP_ICONS[kind], x * size + size / 2, y * size + size / 2);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function drawFreezeOverlay(ts) {
  if (!frozenUntil || ts >= frozenUntil) return;
  const remaining = Math.ceil((frozenUntil - ts) / 1000);
  ctx.fillStyle = 'rgba(77,208,225,0.18)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#4dd0e1';
  ctx.font = 'bold 14px Courier New';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`❄ CONGELADO ${remaining}s`, canvas.width / 2, 8);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  if (current.powerUp) {
    drawPowerUpBlock(ctx, current.x, gy, current.powerUp, BLOCK, 0.25);
  } else {
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);
  }

  // current piece
  if (current.powerUp) {
    drawPowerUpBlock(ctx, current.x, current.y, current.powerUp, BLOCK, 1);
  } else {
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  }

  drawFreezeOverlay(performance.now());
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (next.powerUp) {
    drawPowerUpBlock(nextCtx, 1, 1, next.powerUp, NB * 1.3, 1);
    return;
  }
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;

  // freeze: skip auto-drop accumulation
  if (frozenUntil) {
    if (ts >= frozenUntil) frozenUntil = 0;
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
      }
    }
  }

  if (gameOver) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  pendingPowerUp = false;
  pendingReward = false;
  lastPowerUpMilestone = 0;
  frozenUntil = 0;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

init();
