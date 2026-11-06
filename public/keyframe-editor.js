import { decodeBeatMap, decodeBeatStyles, TORCH_EFFECTS } from './safety.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const palette = Object.entries(TORCH_EFFECTS).filter(([, effect]) => effect.pulses > 0).map(([id, effect]) => [id, effect.label]);
const hueColor = (h, s, v = 1) => { const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return `#${[r, g, b].map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`; };
function colorHueSaturation(hex) { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let h = 0; if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); return { h: (h + 360) % 360, s: max ? d / max : 0, v: max }; }
const rowHeight = 48;
const viewportStorageKey = 'crowdsync.cuegraph.viewport.v2';
let activePlan = null, activeUpdate = null, selectedIndex = 0, graphResize = null;
let graphPositions = {}, graphStorageKey = '', pointerDrag = null, activeGraphRedraw = null, activePlaybackIndex = -1, followPlayback = true;
let graphView = loadView(), inspectorTab = 'properties';

function loadView() {
  try {
    const value = JSON.parse(localStorage.getItem(viewportStorageKey) || '{}');
    const x = Number(value.x), y = Number(value.y), zoom = Number(value.zoom);
    return { x: Number.isFinite(x) ? Math.max(-1_000_000, Math.min(1_000_000, x)) : 0, y: Number.isFinite(y) ? Math.max(-1_000_000, Math.min(1_000_000, y)) : 0, zoom: Number.isFinite(zoom) ? Math.max(.22, Math.min(4, zoom)) : 1 };
  }
  catch { return { x: 0, y: 0, zoom: 1 }; }
}
function persistView() { try { localStorage.setItem(viewportStorageKey, JSON.stringify(graphView)); } catch {} }
function hashMap(value) { let hash = 2166136261; for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function validGraphPositions(value, beatCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, point]) => /^\d+$/.test(key) && Number(key) < beatCount && point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000).map(([key, point]) => [key, { x: point.x, y: point.y }]));
}
function frameStyle(plan, index, table, indices) {
  const styleIndex = indices?.[index] ?? 0;
  return table[styleIndex] || { effect: 'pulse', screenColor: plan?.cues?.[0]?.screenColor || '#f4f1e8' };
}
function visibleBeatIndexes(times, focusIndex = selectedIndex) {
  const start = Math.max(0, Math.min(times.length - 1, Math.floor(Math.max(0, focusIndex) / 36) * 36));
  const count = Math.min(36, times.length - start);
  return Array.from({ length: count }, (_, i) => start + i);
}
function defaultPosition(nodeOrder, indexes, width, height) {
  const columns = Math.max(2, Math.min(7, Math.floor(width / 126)));
  const row = Math.floor(nodeOrder / columns), rows = Math.ceil(indexes.length / columns);
  const rowSize = Math.min(columns, indexes.length - row * columns);
  const col = row % 2 ? rowSize - 1 - (nodeOrder % columns) : nodeOrder % columns;
  const x = rowSize === 1 ? 0 : -width / 2 + 66 + col * Math.max(1, width - 132) / (rowSize - 1);
  const y = rows === 1 ? 0 : -height / 2 + 34 + row * Math.max(1, height - 68) / (rows - 1);
  return { x, y };
}
function worldPosition(index, order, indexes, width, height) { return graphPositions[index] || defaultPosition(order, indexes, width, height); }
function fitGraph(canvas, times) {
  const width = Number(canvas.dataset.width), height = Number(canvas.dataset.height), indexes = visibleBeatIndexes(times, followPlayback && activePlaybackIndex >= 0 ? activePlaybackIndex : selectedIndex);
  const points = indexes.map((index, order) => worldPosition(index, order, indexes, width, height));
  const minX = Math.min(...points.map((point) => point.x)) - 60, maxX = Math.max(...points.map((point) => point.x)) + 60;
  const minY = Math.min(...points.map((point) => point.y)) - 48, maxY = Math.max(...points.map((point) => point.y)) + 48;
  graphView.zoom = Math.max(.22, Math.min(2.5, (width - 36) / Math.max(1, maxX - minX), (height - 36) / Math.max(1, maxY - minY)));
  graphView.x = -(minX + maxX) / 2; graphView.y = -(minY + maxY) / 2;
  persistView(); drawGraph(canvas, times, activePlan.beatStyleTable || [activePlan.cues[0]], activePlan.beatStyles ? decodeBeatStyles(activePlan.beatStyles, times.length, activePlan.beatStyleTable || [activePlan.cues[0]]) : Array(times.length).fill(0), activePlaybackIndex);
}
function screenToWorld(x, y, width, height) {
  return { x: (x - width / 2 - graphView.x * graphView.zoom) / graphView.zoom, y: (y - height / 2 - graphView.y * graphView.zoom) / graphView.zoom };
}
function drawGraph(canvas, times, styles, indices, playingIndex = activePlaybackIndex) {
  if (!canvas || !times?.length) return;
  const rect = canvas.getBoundingClientRect(), width = Math.max(320, rect.width), indexes = visibleBeatIndexes(times);
  const columns = Math.max(2, Math.min(7, Math.floor(width / 126))), rows = Math.ceil(indexes.length / columns);
  const height = Math.max(380, Math.min(1_600, rows * 76 + 56));
  if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1), lightTheme = document.body.dataset.theme === 'light';
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = lightTheme ? '#f5f4ef' : '#0c0c0b'; ctx.fillRect(0, 0, width, height);
  const spacing = Math.max(8, Math.min(96, 24 * graphView.zoom));
  const originX = ((width / 2 + graphView.x * graphView.zoom) % spacing + spacing) % spacing;
  const originY = ((height / 2 + graphView.y * graphView.zoom) % spacing + spacing) % spacing;
  ctx.lineWidth = 1;
  for (let x = originX; x < width; x += spacing) { const major = Math.round((x - originX) / spacing) % 5 === 0; ctx.strokeStyle = lightTheme ? (major ? '#d3d2cc' : '#e7e6e1') : (major ? '#292927' : '#191918'); ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, height); ctx.stroke(); }
  for (let x = originX - spacing; x >= 0; x -= spacing) { const major = Math.round((originX - x) / spacing) % 5 === 0; ctx.strokeStyle = lightTheme ? (major ? '#d3d2cc' : '#e7e6e1') : (major ? '#292927' : '#191918'); ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, height); ctx.stroke(); }
  for (let y = originY; y < height; y += spacing) { const major = Math.round((y - originY) / spacing) % 5 === 0; ctx.strokeStyle = lightTheme ? (major ? '#d3d2cc' : '#e7e6e1') : (major ? '#292927' : '#191918'); ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(width, y + .5); ctx.stroke(); }
  for (let y = originY - spacing; y >= 0; y -= spacing) { const major = Math.round((originY - y) / spacing) % 5 === 0; ctx.strokeStyle = lightTheme ? (major ? '#d3d2cc' : '#e7e6e1') : (major ? '#292927' : '#191918'); ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(width, y + .5); ctx.stroke(); }
  const focusIndex = followPlayback && playingIndex >= 0 ? playingIndex : selectedIndex;
  const nodes = visibleBeatIndexes(times, focusIndex).map((beatIndex, order, visible) => ({ beatIndex, ...worldPosition(beatIndex, order, visible, width, height), style: frameStyle(activePlan, beatIndex, styles, indices), selected: beatIndex === selectedIndex, active: beatIndex === playingIndex }));
  ctx.save(); ctx.translate(width / 2 + graphView.x * graphView.zoom, height / 2 + graphView.y * graphView.zoom); ctx.scale(graphView.zoom, graphView.zoom);
  ctx.lineWidth = 1.6;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], b = nodes[i + 1], startX = a.x + 47, endX = b.x - 47, bend = (endX - startX) * .45;
    ctx.strokeStyle = a.selected || b.selected ? (lightTheme ? '#494842' : '#c2bfb5') : (lightTheme ? '#85847d' : '#66655e');
    ctx.beginPath(); ctx.moveTo(startX, a.y); ctx.bezierCurveTo(startX + bend, a.y, endX - bend, b.y, endX, b.y); ctx.stroke();
    ctx.fillStyle = lightTheme ? '#66655e' : '#aaa89f'; ctx.fillRect(startX - 2, a.y - 3, 5, 6); ctx.fillRect(endX - 2, b.y - 3, 5, 6);
  }
  for (const node of nodes) {
    const left = node.x - 44, top = node.y - 21;
    ctx.fillStyle = lightTheme ? '#e9e8e2' : '#20201e'; ctx.strokeStyle = node.selected ? (lightTheme ? '#252522' : '#e0ddd4') : (lightTheme ? '#aaa9a1' : '#58574f'); ctx.lineWidth = node.selected ? 2 : 1;
    if (node.active) { ctx.shadowColor = node.style.screenColor; ctx.shadowBlur = lightTheme ? 14 : 20; }
    ctx.fillRect(left, top, 88, 42); ctx.strokeRect(left + .5, top + .5, 87, 41);
    ctx.shadowBlur = 0;
    if (node.active) { ctx.strokeStyle = node.style.screenColor; ctx.lineWidth = 1.4; ctx.strokeRect(left + 2, top + 2, 83, 37); }
    ctx.fillStyle = node.style.screenColor; ctx.fillRect(left + 6, top + 7, 5, 28);
    ctx.fillStyle = lightTheme ? '#20201e' : '#efeee9'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
    ctx.fillText(`BEAT ${String(node.beatIndex + 1).padStart(2, '0')}`, left + 16, top + 17);
    ctx.fillStyle = lightTheme ? '#62615b' : '#b8b6ae'; ctx.font = '9px ui-sans-serif, sans-serif';
    ctx.fillText((TORCH_EFFECTS[node.style.effect]?.label || node.style.effect).slice(0, 13).toUpperCase(), left + 16, top + 32);
    ctx.fillStyle = node.style.screenColor; ctx.fillRect(left + 80, node.y - 3, 7, 6);
    ctx.fillStyle = lightTheme ? '#67665f' : '#a9a79f'; ctx.fillRect(left - 3, node.y - 3, 7, 6);
  }
  ctx.restore();
  canvas.dataset.width = String(width); canvas.dataset.height = String(height);
  const zoomLabel = document.querySelector('#graph-zoom-level'); if (zoomLabel) zoomLabel.value = `${Math.round(graphView.zoom * 100)}%`;
  const total = times.length, pageStart = Math.max(0, Math.min(total - 1, Math.floor(Math.max(0, focusIndex) / 36) * 36));
  const pageLabel = document.querySelector('#beat-page-label'); if (pageLabel) pageLabel.textContent = `${pageStart + 1}–${Math.min(total, pageStart + 36)} / ${total}`;
  const follow = document.querySelector('#beat-follow'); if (follow) { follow.setAttribute('aria-pressed', String(followPlayback)); follow.classList.toggle('selected', followPlayback); }
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
  const label = shell.querySelector('#selected-keyframe'), time = times[selectedIndex];
  if (label && time !== undefined) label.textContent = `BEAT ${String(selectedIndex + 1).padStart(2, '0')} · ${(time / 1000).toFixed(2)} s`;
  const timeLabel = shell.querySelector('#keyframe-property-time'); if (timeLabel && time !== undefined) timeLabel.textContent = `At ${(time / 1000).toFixed(2)} s`;
}
function setInspectorTab(shell, tab) {
  inspectorTab = tab;
  shell.querySelectorAll('[data-inspector-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.inspectorTab === tab)));
  shell.querySelectorAll('[data-inspector-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.inspectorPanel !== tab));
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
    select.addEventListener('click', () => { selectedIndex = index; followPlayback = false; setInspectorTab(document.querySelector('#keyframe-editor'), 'properties'); renderKeyframeEditor(activePlan, activeUpdate, false); });
    effect.addEventListener('change', () => updateRow(index, 'effect', effect.value, table, indices));
    color.addEventListener('change', () => updateRow(index, 'screenColor', color.value, table, indices));
    row.append(select, effect, color); fragment.append(row);
  }
  const bottom = document.createElement('div'); bottom.style.height = `${Math.max(0, (times.length - end) * rowHeight)}px`; fragment.append(bottom);
  viewport.replaceChildren(fragment); viewport.scrollTop = oldScroll;
}
function renderKeyframeEditor(plan, onUpdate, resetSelection = true) {
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
  const nextStorageKey = `crowdsync.cuegraph.nodes.v2.${plan.durationMs}.${times.length}.${hashMap(plan.beatMap)}`;
  if (nextStorageKey !== graphStorageKey) { graphStorageKey = nextStorageKey; graphPositions = {}; try { graphPositions = validGraphPositions(JSON.parse(localStorage.getItem(graphStorageKey) || '{}'), times.length); } catch {} }
  const canvas = shell.querySelector('canvas'), viewport = shell.querySelector('.keyframe-list'), effectControl = shell.querySelector('#keyframe-property-effect'), colorControl = shell.querySelector('#keyframe-property-color'), lightboxEffects = shell.querySelector('#keyframe-lightbox-effects'), lightboxColor = shell.querySelector('#keyframe-lightbox-color-value'), lightboxWheel = shell.querySelector('#keyframe-lightbox-wheel'), lightboxMarker = lightboxWheel.querySelector('span'), lightboxSaturation = shell.querySelector('#keyframe-lightbox-saturation'), lightboxBrightness = shell.querySelector('#keyframe-lightbox-brightness'), lightboxSaturationValue = shell.querySelector('#keyframe-lightbox-saturation-value'), lightboxBrightnessValue = shell.querySelector('#keyframe-lightbox-brightness-value');
  shell.querySelector('#keyframe-total').textContent = `${times.length} BEATS · 36 NODE VIEW`;
  const propertyStyle = frameStyle(plan, selectedIndex, table, indices);
  effectControl.replaceChildren(...palette.map(([id, label]) => new Option(TORCH_EFFECTS[id]?.label || label, id)));
  effectControl.value = propertyStyle.effect; colorControl.value = propertyStyle.screenColor;
  lightboxColor.value = propertyStyle.screenColor;
  lightboxEffects.replaceChildren(...palette.map(([id, label]) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'keyframe-lightbox-chip'; button.textContent = label; button.draggable = true; button.dataset.effect = id; button.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', `effect:${id}`)); button.addEventListener('click', () => updateRow(selectedIndex, 'effect', id, table, indices)); return button; }));
  const wheelHueSat = colorHueSaturation(propertyStyle.screenColor), wheelRadius = Math.max(1, lightboxWheel.clientWidth / 2 - 11);
  lightboxWheel.setAttribute('aria-valuenow', String(Math.round(wheelHueSat.h)));
  lightboxMarker.style.left = `calc(50% + ${Math.cos(wheelHueSat.h * Math.PI / 180) * wheelRadius}px)`;
  lightboxMarker.style.top = `calc(50% - ${Math.sin(wheelHueSat.h * Math.PI / 180) * wheelRadius}px)`;
  lightboxMarker.style.transform = `translate(-50%,-50%) rotate(${wheelHueSat.h + 90}deg)`;
  lightboxSaturation.value = String(Math.round(wheelHueSat.s * 100)); lightboxBrightness.value = String(Math.round(wheelHueSat.v * 100));
  lightboxSaturationValue.value = `${lightboxSaturation.value}%`; lightboxBrightnessValue.value = `${lightboxBrightness.value}%`;
  updateSelectedLabel(shell, times); setInspectorTab(shell, inspectorTab);
  drawGraph(canvas, times, table, indices, activePlaybackIndex); renderList(viewport, times, table, indices);
  activeGraphRedraw = () => drawGraph(canvas, times, table, indices, activePlaybackIndex);
  viewport.onscroll = () => renderList(viewport, times, table, indices);
  shell.querySelectorAll('[data-inspector-tab]').forEach((button) => { button.onclick = () => setInspectorTab(shell, button.dataset.inspectorTab); });
  effectControl.onchange = () => updateRow(selectedIndex, 'effect', effectControl.value, table, indices);
  colorControl.onchange = () => updateRow(selectedIndex, 'screenColor', colorControl.value, table, indices);
  const selectNode = (index, scrollList = false) => {
    selectedIndex = index; followPlayback = false; setInspectorTab(shell, 'properties'); updateSelectedLabel(shell, times);
    const style = frameStyle(plan, index, table, indices); effectControl.value = style.effect; colorControl.value = style.screenColor; lightboxColor.value = style.screenColor;
    const hs = colorHueSaturation(style.screenColor), radius = Math.max(1, lightboxWheel.clientWidth / 2 - 11);
    lightboxWheel.setAttribute('aria-valuenow', String(Math.round(hs.h))); lightboxMarker.style.left = `calc(50% + ${Math.cos(hs.h * Math.PI / 180) * radius}px)`; lightboxMarker.style.top = `calc(50% - ${Math.sin(hs.h * Math.PI / 180) * radius}px)`; lightboxMarker.style.transform = `translate(-50%,-50%) rotate(${hs.h + 90}deg)`;
    lightboxSaturation.value = String(Math.round(hs.s * 100)); lightboxBrightness.value = String(Math.round(hs.v * 100)); lightboxSaturationValue.value = `${lightboxSaturation.value}%`; lightboxBrightnessValue.value = `${lightboxBrightness.value}%`;
    if (scrollList) viewport.scrollTop = Math.max(0, index * rowHeight - rowHeight * 2);
    renderList(viewport, times, table, indices); drawGraph(canvas, times, table, indices);
  };
  canvas.onpointerdown = (event) => {
    if (event.button !== 0) return;
    const rect = canvas.getBoundingClientRect(), width = Number(canvas.dataset.width), height = Number(canvas.dataset.height), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const world = screenToWorld(x, y, width, height), indexes = visibleBeatIndexes(times, followPlayback && activePlaybackIndex >= 0 ? activePlaybackIndex : selectedIndex);
    const hit = indexes.map((index, order) => ({ index, ...worldPosition(index, order, indexes, width, height) })).find((node) => Math.abs(node.x - world.x) <= 46 && Math.abs(node.y - world.y) <= 23);
    if (hit) { selectNode(hit.index, true); pointerDrag = { type: 'node', index: hit.index, pointerId: event.pointerId }; }
    else pointerDrag = { type: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: graphView.x, viewY: graphView.y };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (!pointerDrag || !canvas.hasPointerCapture(event.pointerId) || pointerDrag.pointerId !== event.pointerId) return;
    if (pointerDrag.type === 'pan') { graphView.x = pointerDrag.viewX + (event.clientX - pointerDrag.x) / graphView.zoom; graphView.y = pointerDrag.viewY + (event.clientY - pointerDrag.y) / graphView.zoom; drawGraph(canvas, times, table, indices); return; }
    const rect = canvas.getBoundingClientRect(), world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, Number(canvas.dataset.width), Number(canvas.dataset.height));
    graphPositions[pointerDrag.index] = world; drawGraph(canvas, times, table, indices);
  };
  const finishPointer = (event) => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    try { localStorage.setItem(graphStorageKey, JSON.stringify(graphPositions)); } catch {}
    persistView(); pointerDrag = null;
  };
  canvas.onpointerup = finishPointer; canvas.onpointercancel = finishPointer; canvas.onlostpointercapture = finishPointer;
  canvas.onwheel = (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect(), sx = event.clientX - rect.left, sy = event.clientY - rect.top, width = Number(canvas.dataset.width), height = Number(canvas.dataset.height), fixed = screenToWorld(sx, sy, width, height);
    graphView.zoom = Math.max(.22, Math.min(4, graphView.zoom * Math.exp(-event.deltaY * .0012)));
    graphView.x = (sx - width / 2) / graphView.zoom - fixed.x; graphView.y = (sy - height / 2) / graphView.zoom - fixed.y;
    persistView(); drawGraph(canvas, times, table, indices);
  };
  canvas.ondragover = event => { if (event.dataTransfer.types.includes('text/plain')) event.preventDefault(); };
  canvas.ondrop = event => {
    event.preventDefault(); const payload = event.dataTransfer.getData('text/plain'); if (!payload.startsWith('effect:')) return;
    const effect = payload.slice(7); if (!palette.some(([id]) => id === effect)) return;
    const rect = canvas.getBoundingClientRect(), width = Number(canvas.dataset.width), height = Number(canvas.dataset.height), world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, width, height), indexes = visibleBeatIndexes(times, selectedIndex);
    const hit = indexes.map((index, order) => ({ index, ...worldPosition(index, order, indexes, width, height) })).find(node => Math.abs(node.x - world.x) <= 52 && Math.abs(node.y - world.y) <= 28);
    const target = hit?.index ?? selectedIndex; selectedIndex = target; followPlayback = false; setInspectorTab(shell, 'lightbox'); updateRow(target, 'effect', effect, table, indices);
  };
  let wheelPointer = null, wheelPendingColor = propertyStyle.screenColor, wheelHue = wheelHueSat.h;
  const placeWheelMarker = h => { const radius = Math.max(1, lightboxWheel.clientWidth / 2 - 7); lightboxMarker.style.left = `calc(50% + ${Math.cos(h * Math.PI / 180) * radius}px)`; lightboxMarker.style.top = `calc(50% - ${Math.sin(h * Math.PI / 180) * radius}px)`; lightboxMarker.style.transform = `translate(-50%,-50%) rotate(${h + 90}deg)`; lightboxWheel.setAttribute('aria-valuenow', String(Math.round(h))); };
  const currentWheelColor = () => hueColor(wheelHue, Number(lightboxSaturation.value) / 100, Number(lightboxBrightness.value) / 100);
  const moveLightboxWheel = event => { const rect = lightboxWheel.getBoundingClientRect(), dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2; if (Math.hypot(dx, dy) > 1) wheelHue = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360; wheelPendingColor = currentWheelColor(); lightboxColor.value = wheelPendingColor; placeWheelMarker(wheelHue); };
  lightboxWheel.onpointerdown = event => { const rect = lightboxWheel.getBoundingClientRect(), dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2; if (Math.hypot(dx, dy) < rect.width / 2 - 20) return; wheelPointer = event.pointerId; lightboxWheel.setPointerCapture(event.pointerId); moveLightboxWheel(event); };
  lightboxWheel.onpointermove = event => { if (wheelPointer === event.pointerId) moveLightboxWheel(event); };
  const finishWheel = event => { if (wheelPointer !== event.pointerId) return; wheelPointer = null; updateRow(selectedIndex, 'screenColor', wheelPendingColor, table, indices); };
  lightboxWheel.onpointerup = finishWheel; lightboxWheel.onpointercancel = finishWheel;
  lightboxWheel.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); wheelHue = (wheelHue + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? 358 : 2)) % 360; wheelPendingColor = currentWheelColor(); lightboxColor.value = wheelPendingColor; placeWheelMarker(wheelHue); updateRow(selectedIndex, 'screenColor', wheelPendingColor, table, indices); };
  const syncLightboxSliders = () => { const hs = colorHueSaturation(lightboxColor.value); wheelHue = hs.h; lightboxSaturation.value = String(Math.round(hs.s * 100)); lightboxBrightness.value = String(Math.round(hs.v * 100)); lightboxSaturationValue.value = `${lightboxSaturation.value}%`; lightboxBrightnessValue.value = `${lightboxBrightness.value}%`; placeWheelMarker(hs.h, hs.s); };
  lightboxColor.onchange = () => { wheelPendingColor = lightboxColor.value; syncLightboxSliders(); updateRow(selectedIndex, 'screenColor', wheelPendingColor, table, indices); };
  const updateLightboxColor = () => { wheelPendingColor = currentWheelColor(); lightboxColor.value = wheelPendingColor; lightboxSaturationValue.value = `${lightboxSaturation.value}%`; lightboxBrightnessValue.value = `${lightboxBrightness.value}%`; placeWheelMarker(wheelHue); };
  lightboxSaturation.oninput = updateLightboxColor; lightboxBrightness.oninput = updateLightboxColor;
  lightboxSaturation.onchange = lightboxBrightness.onchange = () => updateRow(selectedIndex, 'screenColor', wheelPendingColor, table, indices);
  shell.querySelectorAll('[data-graph-zoom]').forEach((button) => { button.onclick = () => {
    if (button.dataset.graphZoom === 'fit') { fitGraph(canvas, times); return; }
    else graphView.zoom = Math.max(.22, Math.min(4, graphView.zoom * (button.dataset.graphZoom === 'in' ? 1.2 : 1 / 1.2)));
    persistView(); drawGraph(canvas, times, table, indices);
  }; });
  shell.querySelectorAll('[data-beat-page]').forEach((button) => { button.onclick = () => {
    const focus = followPlayback && activePlaybackIndex >= 0 ? activePlaybackIndex : selectedIndex;
    const pageStart = Math.floor(focus / 36) * 36;
    selectedIndex = Math.max(0, Math.min(times.length - 1, pageStart + (button.dataset.beatPage === 'next' ? 36 : -36)));
    followPlayback = false; updateSelectedLabel(shell, times); renderKeyframeEditor(activePlan, activeUpdate, false);
  }; });
  const followButton = shell.querySelector('#beat-follow'); if (followButton) followButton.onclick = () => { followPlayback = !followPlayback; if (followPlayback && activePlaybackIndex >= 0) selectedIndex = activePlaybackIndex; renderKeyframeEditor(activePlan, activeUpdate, false); };
  if (graphResize) graphResize.disconnect();
  graphResize = new ResizeObserver(() => drawGraph(canvas, times, table, indices)); graphResize.observe(canvas.parentElement);
}

export function setKeyframePlaybackTime(elapsedMs) {
  if (!activePlan?.beatMap || elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= activePlan.durationMs) {
    if (activePlaybackIndex !== -1) { activePlaybackIndex = -1; activeGraphRedraw?.(); }
    return;
  }
  const times = decodeBeatMap(activePlan.beatMap, activePlan.durationMs); if (!times) return;
  let low = 0, high = times.length;
  while (low < high) { const middle = (low + high) >> 1; if (times[middle] <= elapsedMs) low = middle + 1; else high = middle; }
  const next = low - 1;
  if (next !== activePlaybackIndex) { activePlaybackIndex = next; activeGraphRedraw?.(); }
}

export { renderKeyframeEditor };
window.addEventListener('crowdsync:theme', () => activeGraphRedraw?.());
