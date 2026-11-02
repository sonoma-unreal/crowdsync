import { lucide } from './lucide.js';

const form = document.querySelector('#join-form');
const input = document.querySelector('#join-code');
const error = document.querySelector('#home-error');
const joinButton = form.querySelector('button[type="submit"]');
const themeToggle = document.querySelector('#theme-toggle');
const stage = document.querySelector('.home-stage');
const stageCells = [...stage.querySelectorAll('.stage-grid span')];
const featurePoints = [...document.querySelectorAll('.hero-point[data-effect]')];
const themeKey = 'crowdsync.home.theme';
const STAGE_COLUMNS = 9;
const STAGE_ROWS = 9;
const unavailableCodeMessage = 'That code is unavailable. Check with your host or scan their QR code if available.';

stageCells.forEach((cell, index) => {
  const row = Math.floor(index / STAGE_COLUMNS);
  const column = index % STAGE_COLUMNS;
  const radius = Math.hypot(column - 4, row - 4);
  cell.style.setProperty('--ripple-delay', `${Math.round(radius * 90)}ms`);
});

const cometPath = [];
for (let row = 0; row < STAGE_ROWS; row += 1) {
  for (let column = 0; column < STAGE_COLUMNS; column += 1) cometPath.push(row * STAGE_COLUMNS + column);
  if (row < STAGE_ROWS - 1) cometPath.push((row + 1) * STAGE_COLUMNS + STAGE_COLUMNS - 1);
}

const activeLayers = new Map();

function createEffectLayer(effect) {
  const layer = document.createElement('div');
  layer.className = `stage-effect stage-effect-${effect}`;
  layer.setAttribute('aria-hidden', 'true');
  const cells = Array.from({ length: STAGE_COLUMNS * STAGE_ROWS }, (_, index) => {
    const cell = document.createElement('span');
    const row = Math.floor(index / STAGE_COLUMNS);
    const column = index % STAGE_COLUMNS;
    cell.style.setProperty('--sweep-delay', `${column * 85}ms`);
    cell.style.setProperty('--ripple-delay', `${Math.round(Math.hypot(column - 4, row - 4) * 90)}ms`);
    layer.append(cell);
    return cell;
  });

  if (effect === 'sparkle') {
    const picked = new Set();
    while (picked.size < 13) picked.add(Math.floor(Math.random() * cells.length));
    for (const index of picked) {
      const cell = cells[index];
      cell.classList.add('is-sparkle');
      cell.style.setProperty('--sparkle-delay', `${Math.random() * 1100}ms`);
      cell.style.setProperty('--sparkle-duration', `${650 + Math.random() * 800}ms`);
    }
  }

  stage.append(layer);
  const layerState = { layer, cells, cometTimer: null, finishTimer: null };
  if (effect === 'comet') {
    let step = 0;
    let trail = [];
    const advance = () => {
      const head = cells[cometPath[step % cometPath.length]];
      head.classList.add('comet-head');
      trail.unshift(head);
      if (trail.length > 4) trail.pop().classList.remove('comet-head', 'comet-trail-1', 'comet-trail-2', 'comet-trail-3');
      trail.forEach((cell, index) => {
        cell.classList.remove('comet-head', 'comet-trail-1', 'comet-trail-2', 'comet-trail-3');
        cell.classList.add(index === 0 ? 'comet-head' : `comet-trail-${index}`);
      });
      step += 1;
    };
    advance();
    layerState.cometTimer = setInterval(advance, 95);
  }
  return layerState;
}

function finishEffect(point) {
  const layerState = activeLayers.get(point);
  if (!layerState || layerState.layer.classList.contains('is-finishing')) return;
  activeLayers.delete(point);
  layerState.layer.classList.add('is-finishing');
  layerState.finishTimer = setTimeout(() => {
    clearInterval(layerState.cometTimer);
    layerState.layer.remove();
  }, 760);
}

featurePoints.forEach((point) => {
  const preview = () => {
    if (!activeLayers.has(point)) activeLayers.set(point, createEffectLayer(point.dataset.effect));
  };
  point.addEventListener('pointerenter', preview);
  point.addEventListener('focus', preview);
  point.addEventListener('click', preview);
  point.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch' && document.activeElement !== point) finishEffect(point);
  });
  point.addEventListener('blur', () => finishEffect(point));
});

function setTheme(theme) {
  const light = theme === 'light';
  document.body.dataset.theme = light ? 'light' : 'dark';
  themeToggle.setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} theme`);
  themeToggle.querySelector('.theme-label').textContent = light ? 'LIGHT' : 'DARK';
  themeToggle.querySelector('.theme-glyph').innerHTML = lucide(light ? 'moon' : 'sun', 15);
  document.querySelector('meta[name="theme-color"]').content = light ? '#f4f3ef' : '#090909';
  try { localStorage.setItem(themeKey, light ? 'light' : 'dark'); } catch {}
}

let savedTheme = 'dark';
try { savedTheme = localStorage.getItem(themeKey) || 'dark'; } catch {}
setTheme(savedTheme);
themeToggle.addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));

const joinParams = new URLSearchParams(location.search);
if (joinParams.get('join') === 'unavailable') {
  input.value = (joinParams.get('code') || '').replace(/\D/g, '').slice(0, 6);
  error.textContent = unavailableCodeMessage;
}

input.addEventListener('input', () => {
  input.value = input.value.replace(/\D/g, '').slice(0, 6);
  error.textContent = '';
});

let checkingShowCode = false;
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (checkingShowCode) return;
  const code = input.value.trim();
  if (!/^\d{6}$/.test(code)) { error.textContent = 'Enter all six digits.'; return; }
  checkingShowCode = true;
  joinButton.disabled = true;
  form.setAttribute('aria-busy', 'true');
  error.textContent = 'Checking code';
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (!response.ok) {
      error.textContent = response.status === 404 ? unavailableCodeMessage : 'Could not check the code right now. Try again.';
      return;
    }
    const data = await response.json();
    if (data.room?.id !== code) {
      error.textContent = unavailableCodeMessage;
      return;
    }
    location.assign(`/join/${code}`);
  } catch {
    error.textContent = 'Could not check the code right now. Try again.';
  } finally {
    checkingShowCode = false;
    joinButton.disabled = false;
    form.removeAttribute('aria-busy');
  }
});
