import { decodeBeatMap, decodeBeatStyles, TORCH_EFFECTS } from './safety.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const palette = Object.entries(TORCH_EFFECTS).filter(([, effect]) => effect.pulses > 0).map(([id, effect]) => [id, effect.label]);
const rowHeight = 48;
let activePlan = null, activeUpdate = null, selectedIndex = 0, graphResize = null;

function frameStyle(plan, index, table, indices) {
  const styleIndex = indices?.[index] ?? 0;
  return table[styleIndex] || { effect: 'pulse', screenColor: plan?.cues?.[0]?.screenColor || '#f4f1e8' };
}

function drawGraph(canvas, times, styles, indices) {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(320, rect.width), height = 204;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b0c0c'; ctx.fillRect(0, 0, width, height);
  const cols = Math.max(1, Math.min(36, times.length)), pad = 28, gap = cols > 1 ? (width - pad * 2) / (cols - 1) : 0;
  const baseline = height / 2;
  ctx.strokeStyle = '#454640'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad, baseline); ctx.lineTo(width - pad, baseline); ctx.stroke();
  for (let i = 0; i < cols; i++) {
    const idx = cols === 1 ? 0 : Math.round(i * (times.length - 1) / (cols - 1));
    const x = pad + i * gap, y = baseline + (i % 2 ? 28 : -28), style = frameStyle(activePlan, idx, styles, indices), selected = idx === selectedIndex;
    ctx.strokeStyle = selected ? '#d4d0c6' : '#55564f'; ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(x, baseline); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = style.screenColor; ctx.strokeStyle = selected ? '#f2efe7' : '#77776e';
    ctx.beginPath(); ctx.roundRect(x - 20, y - 15, 40, 30, 5); ctx.fill(); ctx.stroke();
    if (times.length <= 36) { ctx.fillStyle = '#111'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText(String(idx + 1).padStart(2, '0'), x, y + 4); }
  }
  canvas.dataset.columns = String(cols); canvas.dataset.pad = String(pad); canvas.dataset.gap = String(gap); canvas.dataset.width = String(width);
}

function updateRow(index, field, value, table, indices) {
  const current = frameStyle(activePlan, index, table, indices), nextStyle = { ...current, [field]: value };
  let tableIndex = table.findIndex((item) => item.effect === nextStyle.effect && item.screenColor === nextStyle.screenColor);
  const nextTable = [...table];
  if (tableIndex < 0) {
    if (nextTable.length >= 32) { window.dispatchEvent(new CustomEvent('crowdsync:toast', { detail: 'This score has reached 32 distinct beat looks.' })); return; }
    tableIndex = nextTable.length; nextTable.push(nextStyle);
  }
  const nextIndices = [...indices]; nextIndices[index] = tableIndex;
  activeUpdate(nextIndices.map((id) => alphabet[id]).join(''), nextTable);
}

function renderList(viewport, times, table, indices) {
  const oldScroll = viewport.scrollTop, first = Math.max(0, Math.floor(oldScroll / rowHeight) - 1), visible = Math.ceil(viewport.clientHeight / rowHeight) + 3;
  const end = Math.min(times.length, first + visible), fragment = document.createDocumentFragment();
  const top = document.createElement('div'); top.style.height = `${first * rowHeight}px`; fragment.append(top);
  for (let index = first; index < end; index++) {
    const style = frameStyle(activePlan, index, table, indices), row = document.createElement('div');
    row.className = `keyframe-row${index === selectedIndex ? ' selected' : ''}`; row.dataset.index = String(index);
    const select = document.createElement('button'); select.type = 'button'; select.className = 'keyframe-time'; select.textContent = `${String(index + 1).padStart(2, '0')} · ${(times[index] / 1000).toFixed(2)}s`; select.setAttribute('aria-label', `Select beat ${index + 1} at ${(times[index] / 1000).toFixed(2)} seconds`);
    const effect = document.createElement('select'); effect.className = 'keyframe-effect'; effect.setAttribute('aria-label', `Beat ${index + 1} effect`);
    for (const [id, label] of palette) { const option = new Option(TORCH_EFFECTS[id]?.label || label, id); effect.append(option); }
    effect.value = style.effect;
    const color = document.createElement('input'); color.type = 'color'; color.className = 'keyframe-color'; color.value = style.screenColor; color.setAttribute('aria-label', `Beat ${index + 1} screen color`);
    select.addEventListener('click', () => { selectedIndex = index; document.querySelector('#selected-keyframe').textContent = `BEAT ${String(index + 1).padStart(2, '0')} · ${(times[index] / 1000).toFixed(2)} s`; renderKeyframeEditor(activePlan, activeUpdate, false); });
    effect.addEventListener('change', () => updateRow(index, 'effect', effect.value, table, indices));
    color.addEventListener('change', () => updateRow(index, 'screenColor', color.value, table, indices));
    row.append(select, effect, color); fragment.append(row);
  }
  const bottom = document.createElement('div'); bottom.style.height = `${Math.max(0, (times.length - end) * rowHeight)}px`; fragment.append(bottom);
  viewport.replaceChildren(fragment); viewport.scrollTop = oldScroll;
}

export function renderKeyframeEditor(plan, onUpdate, resetSelection = true) {
  const shell = document.querySelector('#keyframe-editor'); if (!shell) return;
  activePlan = plan; activeUpdate = onUpdate;
  const times = plan?.beatMap ? decodeBeatMap(plan.beatMap, plan.durationMs) : null;
  shell.classList.toggle('hidden', !times);
  if (!times) return;
  const initialStyle = { effect: plan.cues[0].effect, screenColor: plan.cues[0].screenColor };
  const table = plan.beatStyleTable?.length ? plan.beatStyleTable : [initialStyle];
  let indices = plan.beatStyles ? decodeBeatStyles(plan.beatStyles, times.length, table) : null;
  if (!indices) indices = Array(times.length).fill(0);
  if (resetSelection) selectedIndex = Math.min(selectedIndex, times.length - 1);
  const canvas = shell.querySelector('canvas'), viewport = shell.querySelector('.keyframe-list');
  shell.querySelector('#keyframe-total').textContent = `${times.length} NODES`;
  shell.querySelector('#selected-keyframe').textContent = `BEAT ${String(selectedIndex + 1).padStart(2, '0')} · ${(times[selectedIndex] / 1000).toFixed(2)} s`;
  drawGraph(canvas, times, table, indices); renderList(viewport, times, table, indices);
  viewport.onscroll = () => renderList(viewport, times, table, indices);
  canvas.onclick = (event) => {
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, cols = Number(canvas.dataset.columns), pad = Number(canvas.dataset.pad), gap = Number(canvas.dataset.gap);
    const point = Math.max(0, Math.min(cols - 1, Math.round((x - pad) / Math.max(1, gap))));
    selectedIndex = cols === 1 ? 0 : Math.round(point * (times.length - 1) / (cols - 1));
    viewport.scrollTop = Math.max(0, selectedIndex * rowHeight - rowHeight * 2);
    shell.querySelector('#selected-keyframe').textContent = `BEAT ${String(selectedIndex + 1).padStart(2, '0')} · ${(times[selectedIndex] / 1000).toFixed(2)} s`;
    renderKeyframeEditor(activePlan, activeUpdate, false);
  };
  if (graphResize) graphResize.disconnect();
  graphResize = new ResizeObserver(() => drawGraph(canvas, times, table, indices)); graphResize.observe(canvas.parentElement);
}
