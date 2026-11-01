import { decodeBeatMap, decodeBeatStyles, TORCH_EFFECTS } from './safety.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const palette = Object.entries(TORCH_EFFECTS).filter(([, effect]) => effect.pulses > 0).map(([id, effect]) => [id, effect.label]);
const rowHeight = 48;
let activePlan = null, activeUpdate = null, selectedIndex = 0, graphResize = null;
let graphPositions = {}, graphStorageKey = '';
let pointerDrag = null;
let activeGraphRedraw = null;

function frameStyle(plan, index, table, indices) {
  const styleIndex = indices?.[index] ?? 0;
  return table[styleIndex] || { effect: 'pulse', screenColor: plan?.cues?.[0]?.screenColor || '#f4f1e8' };
}
function visibleBeatIndexes(times) {
  const count = Math.min(36, times.length);
  return Array.from({ length: count }, (_, i) => count === 1 ? 0 : Math.round(i * (times.length - 1) / (count - 1)));
}
function positionFor(index, nodeOrder, indexes, width, height) {
  const saved = graphPositions[index];
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return { x: 54 + saved.x * Math.max(1, width - 108), y: 34 + saved.y * Math.max(1, height - 68) };
  }
  const columns = Math.max(2, Math.min(7, Math.floor(width / 126)));
  const row = Math.floor(nodeOrder / columns), rowCount = Math.ceil(indexes.length / columns);
  const itemsInRow = Math.min(columns, indexes.length - row * columns);
  const col = row % 2 ? itemsInRow - 1 - (nodeOrder % columns) : nodeOrder % columns;
  const x = itemsInRow === 1 ? width / 2 : 54 + col * (width - 108) / (itemsInRow - 1);
  const y = rowCount === 1 ? height / 2 : 34 + row * (height - 68) / (rowCount - 1);
  return { x, y };
}
function drawGraph(canvas, times, styles, indices) {
  if (!canvas || !times?.length) return;
  const rect = canvas.getBoundingClientRect(), width = Math.max(320, rect.width), indexes = visibleBeatIndexes(times);
  const columns = Math.max(2, Math.min(7, Math.floor(width / 126))), rows = Math.ceil(indexes.length / columns);
  const height = Math.max(360, Math.min(680, rows * 62 + 56));
  if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const lightTheme = document.body.dataset.theme === 'light';
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = lightTheme ? '#f5f4ef' : '#0c0c0b'; ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 24) { ctx.strokeStyle = lightTheme ? (x % 120 === 0 ? '#d7d6d0' : '#e7e6e1') : (x % 120 === 0 ? '#292927' : '#191918'); ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, height); ctx.stroke(); }
  for (let y = 0; y < height; y += 24) { ctx.strokeStyle = lightTheme ? (y % 120 === 0 ? '#d7d6d0' : '#e7e6e1') : (y % 120 === 0 ? '#292927' : '#191918'); ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(width, y + .5); ctx.stroke(); }
  const nodes = indexes.map((beatIndex, order) => {
    const point = positionFor(beatIndex, order, indexes, width, height);
    return { beatIndex, ...point, style: frameStyle(activePlan, beatIndex, styles, indices), selected: beatIndex === selectedIndex };
  });
  ctx.lineWidth = 2;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], b = nodes[i + 1], startX = a.x + 47, endX = b.x - 47;
    const bend = (endX - startX) * .45;
    ctx.strokeStyle = a.selected || b.selected ? (lightTheme ? '#4a4944' : '#bcb9af') : (lightTheme ? '#88877f' : '#68675f');
    ctx.beginPath(); ctx.moveTo(startX, a.y); ctx.bezierCurveTo(startX + bend, a.y, endX - bend, b.y, endX, b.y); ctx.stroke();
    ctx.fillStyle = '#bbb8af'; ctx.fillRect(startX - 2, a.y - 3, 5, 6); ctx.fillRect(endX - 2, b.y - 3, 5, 6);
  }
  for (const node of nodes) {
    const left = node.x - 44, top = node.y - 21;
    ctx.fillStyle = lightTheme ? '#e9e8e2' : '#20201e'; ctx.strokeStyle = node.selected ? (lightTheme ? '#252522' : '#e0ddd4') : (lightTheme ? '#aaa9a1' : '#58574f'); ctx.lineWidth = node.selected ? 2 : 1;
    ctx.fillRect(left, top, 88, 42); ctx.strokeRect(left + .5, top + .5, 87, 41);
    ctx.fillStyle = node.style.screenColor; ctx.fillRect(left + 6, top + 7, 5, 28);
    ctx.fillStyle = lightTheme ? '#20201e' : '#efeee9'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
    ctx.fillText(`BEAT ${String(node.beatIndex + 1).padStart(2, '0')}`, left + 16, top + 17);
    ctx.fillStyle = lightTheme ? '#62615b' : '#b8b6ae'; ctx.font = '9px ui-sans-serif, sans-serif';
    const effectName = TORCH_EFFECTS[node.style.effect]?.label || node.style.effect;
    ctx.fillText(effectName.slice(0, 13).toUpperCase(), left + 16, top + 32);
    ctx.fillStyle = node.style.screenColor; ctx.fillRect(left + 80, node.y - 3, 7, 6);
    ctx.fillStyle = lightTheme ? '#67665f' : '#a9a79f'; ctx.fillRect(left - 3, node.y - 3, 7, 6);
  }
  canvas.dataset.width = String(width); canvas.dataset.height = String(height);
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
function updateSelectedLabel(shell, times) {
  const label = shell.querySelector('#selected-keyframe');
  if (label && times[selectedIndex] !== undefined) label.textContent = `BEAT ${String(selectedIndex + 1).padStart(2, '0')} · ${(times[selectedIndex] / 1000).toFixed(2)} s`;
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
    for (const [id, label] of palette) effect.append(new Option(TORCH_EFFECTS[id]?.label || label, id));
    effect.value = style.effect;
    const color = document.createElement('input'); color.type = 'color'; color.className = 'keyframe-color'; color.value = style.screenColor; color.setAttribute('aria-label', `Beat ${index + 1} screen color`);
    select.addEventListener('click', () => { selectedIndex = index; updateSelectedLabel(document.querySelector('#keyframe-editor'), times); renderKeyframeEditor(activePlan, activeUpdate, false); });
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
  const nextStorageKey = `crowdsync.cuegraph.${plan.durationMs}.${times.length}.${String(plan.beatMap).slice(0, 24)}`;
  if (nextStorageKey !== graphStorageKey) {
    graphStorageKey = nextStorageKey; graphPositions = {};
    try { graphPositions = JSON.parse(localStorage.getItem(graphStorageKey) || '{}') || {}; } catch {}
  }
  const canvas = shell.querySelector('canvas'), viewport = shell.querySelector('.keyframe-list');
  shell.querySelector('#keyframe-total').textContent = `${times.length} BEATS · ${Math.min(36, times.length)} VISIBLE NODES`;
  updateSelectedLabel(shell, times);
  drawGraph(canvas, times, table, indices); renderList(viewport, times, table, indices);
  activeGraphRedraw = () => drawGraph(canvas, times, table, indices);
  viewport.onscroll = () => renderList(viewport, times, table, indices);
  canvas.onpointerdown = (event) => {
    if (event.button !== 0) return;
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const indexes = visibleBeatIndexes(times), width = Number(canvas.dataset.width), height = Number(canvas.dataset.height);
    const hit = indexes.map((index, order) => ({ index, ...positionFor(index, order, indexes, width, height) }))
      .find((node) => Math.abs(node.x - x) <= 46 && Math.abs(node.y - y) <= 25);
    if (!hit) return;
    selectedIndex = hit.index; viewport.scrollTop = Math.max(0, selectedIndex * rowHeight - rowHeight * 2); updateSelectedLabel(shell, times); renderList(viewport, times, table, indices); drawGraph(canvas, times, table, indices);
    pointerDrag = { index: hit.index, startX: x, startY: y, moved: false };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (!pointerDrag || !canvas.hasPointerCapture(event.pointerId)) return;
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (Math.hypot(x - pointerDrag.startX, y - pointerDrag.startY) > 2) pointerDrag.moved = true;
    if (!pointerDrag.moved) return;
    graphPositions[pointerDrag.index] = {
      x: Math.max(0, Math.min(1, (x - 54) / Math.max(1, Number(canvas.dataset.width) - 108))),
      y: Math.max(0, Math.min(1, (y - 34) / Math.max(1, Number(canvas.dataset.height) - 68))),
    };
    drawGraph(canvas, times, table, indices);
  };
  const finishDrag = () => {
    if (!pointerDrag) return;
    if (pointerDrag.moved) { try { localStorage.setItem(graphStorageKey, JSON.stringify(graphPositions)); } catch {} }
    pointerDrag = null;
  };
  canvas.onpointerup = finishDrag; canvas.onpointercancel = finishDrag;
  if (graphResize) graphResize.disconnect();
  graphResize = new ResizeObserver(() => drawGraph(canvas, times, table, indices)); graphResize.observe(canvas.parentElement);
}

window.addEventListener('crowdsync:theme', () => activeGraphRedraw?.());
