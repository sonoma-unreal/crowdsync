import { decodeBeatMap, decodeBeatStyles, TORCH_EFFECTS } from './safety.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const effects = Object.entries(TORCH_EFFECTS).filter(([, item]) => item.pulses > 0);
const hueColor = (h, s, v = 1) => { const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return `#${[r, g, b].map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`; };
function colorHueSaturation(hex) { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let h = 0; if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); return { h: (h + 360) % 360, s: max ? d / max : 0, v: max }; }
let activePlan = null, activeUpdate = null, selectedIndex = 0, activePlaybackIndex = -1, activePlaybackTimeMs = null, scrubTimeMs = null, followPlayback = true, redraw = null, inspectorTab = 'properties', drag = null;
function styleAt(plan, index, table, indices) { return table[indices[index] ?? 0] || { effect: 'pulse', screenColor: plan?.cues?.[0]?.screenColor || '#f4f1e8' }; }
function encodeBeatMap(times) {
  let prior = 0, encoded = '';
  for (const time of times) {
    const units = Math.round(time / 20), delta = units - prior; prior = units;
    if (delta < 0 || delta > 2047) return null;
    if (delta < 32) encoded += alphabet[delta];
    else encoded += alphabet[(delta & 31) | 32] + alphabet[Math.floor(delta / 32)];
  }
  return encoded;
}
function drawTimeline(canvas, times, table, indices, playbackIndex = activePlaybackIndex) {
  if (!canvas || !times?.length) return;
  const rect = canvas.getBoundingClientRect(), width = Math.max(320, rect.width), height = 212;
  canvas.width = Math.round(width * Math.min(2, devicePixelRatio || 1)); canvas.height = height * Math.min(2, devicePixelRatio || 1); canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const light = document.body.dataset.theme === 'light', bg = light ? '#f5f4ef' : '#0c0c0b', line = light ? '#d5d3cc' : '#292927', muted = light ? '#696860' : '#99978f', text = light ? '#252521' : '#ecebe5';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  const pageStart = 0, pageEnd = times.length, visible = times, startMs = 0, endMs = Math.max(1, activePlan.durationMs), span = endMs, left = 52, right = width - 18, plotWidth = Math.max(1, right - left);
  ctx.font = '9px ui-monospace, monospace'; ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.fillText('LIGHT EFFECT', 8, 91); ctx.fillText('COLOUR', 8, 159);
  ctx.fillStyle = light ? '#ebeae4' : '#171716'; ctx.fillRect(left, 63, plotWidth, 48); ctx.fillRect(left, 128, plotWidth, 48);
  ctx.strokeStyle = line; ctx.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick++) { const x = left + plotWidth * tick / 4; ctx.beginPath(); ctx.moveTo(x + .5, 35); ctx.lineTo(x + .5, 181); ctx.stroke(); const ms = startMs + span * tick / 4; ctx.fillStyle = muted; ctx.fillText(`${(ms / 1000).toFixed(1)}s`, Math.min(right - 26, x + 3), 24); }
  ctx.fillStyle = muted; ctx.fillText('TIME', 8, 24); ctx.fillText('BEAT', 8, 54);
  const points = visible.map((time, offset) => { const index = pageStart + offset, x = left + ((time - startMs) / span) * plotWidth, style = styleAt(activePlan, index, table, indices); return { index, time, x, style }; });
  for (let i = 0; i < points.length; i++) {
    const point = points[i], nextX = points[i + 1]?.x ?? right, blockW = Math.max(1, Math.min(14, nextX - point.x - 1)), selected = point.index === selectedIndex, playing = point.index === playbackIndex;
    ctx.fillStyle = selected ? (light ? '#d5d2c9' : '#353430') : (light ? '#e3e2dc' : '#222220'); ctx.fillRect(point.x + 1, 68, blockW, 38);
    ctx.fillStyle = point.style.screenColor; ctx.fillRect(point.x + 1, 133, blockW, 38);
    if (playing) { ctx.shadowColor = point.style.screenColor; ctx.shadowBlur = 12; ctx.fillStyle = point.style.screenColor; ctx.fillRect(point.x + 1, 133, blockW, 38); ctx.shadowBlur = 0; }
    ctx.strokeStyle = selected ? text : line; ctx.lineWidth = selected ? 1.5 : 1; ctx.strokeRect(point.x + .5, 68.5, Math.max(1, blockW - 1), 37); ctx.strokeRect(point.x + .5, 133.5, Math.max(1, blockW - 1), 37);
    if (blockW >= 24) { ctx.fillStyle = text; ctx.font = '8px ui-monospace, monospace'; ctx.fillText((TORCH_EFFECTS[point.style.effect]?.label || point.style.effect).slice(0, 4).toUpperCase(), point.x + 4, 91); }

  }
  const playheadTime = scrubTimeMs ?? activePlaybackTimeMs; if (playheadTime !== null && playheadTime >= startMs && playheadTime <= endMs) { const x = left + (playheadTime - startMs) / span * plotWidth; ctx.strokeStyle = '#f2efe6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + .5, 30); ctx.lineTo(x + .5, 183); ctx.stroke(); ctx.fillStyle = '#f2efe6'; ctx.beginPath(); ctx.moveTo(x - 4, 30); ctx.lineTo(x + 4, 30); ctx.lineTo(x, 37); ctx.fill(); }
  canvas.dataset.left = String(left); canvas.dataset.right = String(right); canvas.dataset.start = String(startMs); canvas.dataset.span = String(span); canvas.dataset.pageStart = String(pageStart); canvas.dataset.pageEnd = String(pageEnd);
  const total = document.querySelector('#keyframe-total'); if (total) total.textContent = `${times.length} BEATS · ${(activePlan.durationMs / 1000).toFixed(1)} SEC`;
  const follow = document.querySelector('#beat-follow'); if (follow) { follow.setAttribute('aria-pressed', String(followPlayback)); follow.classList.toggle('selected', followPlayback); }
}
function setTab(shell, tab) { inspectorTab = tab; shell.querySelectorAll('[data-inspector-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.inspectorTab === tab))); shell.querySelectorAll('[data-inspector-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.inspectorPanel !== tab)); }
function updateStyles(index, field, value, table, indices) {
  const nextStyle = { ...styleAt(activePlan, index, table, indices), [field]: value }, nextTable = [...table];
  let id = nextTable.findIndex(style => style.effect === nextStyle.effect && style.screenColor === nextStyle.screenColor);
  if (id < 0) { if (nextTable.length >= 32) { dispatchEvent(new CustomEvent('crowdsync:toast', { detail: 'This score has reached 32 distinct beat looks.' })); return; } id = nextTable.length; nextTable.push(nextStyle); }
  const nextIndices = [...indices]; nextIndices[index] = id; activeUpdate(nextIndices.map(value => alphabet[value]).join(''), nextTable);
}
function renderBeatList(panel, times, table, indices) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < times.length; index++) {
    const row = document.createElement('div'); row.className = `keyframe-row${index === selectedIndex ? ' selected' : ''}`; row.dataset.index = String(index);
    const select = document.createElement('button'); select.type = 'button'; select.className = 'keyframe-time'; select.textContent = `${String(index + 1).padStart(3, '0')} · ${(times[index] / 1000).toFixed(2)}s`; select.setAttribute('aria-label', `Select beat ${index + 1} at ${(times[index] / 1000).toFixed(2)} seconds`);
    const effect = document.createElement('select'); effect.className = 'keyframe-effect'; effect.setAttribute('aria-label', `Beat ${index + 1} light effect`); for (const [id, item] of effects) effect.append(new Option(item.label, id)); effect.value = styleAt(activePlan, index, table, indices).effect;
    const color = document.createElement('input'); color.type = 'color'; color.className = 'keyframe-color'; color.value = styleAt(activePlan, index, table, indices).screenColor; color.setAttribute('aria-label', `Beat ${index + 1} color`);
    select.onclick = () => { selectedIndex = index; followPlayback = false; renderKeyframeEditor(activePlan, activeUpdate, false); };
    effect.onchange = () => updateStyles(index, 'effect', effect.value, table, indices); color.onchange = () => updateStyles(index, 'screenColor', color.value, table, indices); row.append(select, effect, color); fragment.append(row);
  }
  panel.replaceChildren(fragment);
}
function renderKeyframeEditor(plan, onUpdate, resetSelection = true) {
  const shell = document.querySelector('#keyframe-editor'); if (!shell) return;
  activePlan = plan; activeUpdate = onUpdate;
  const times = plan?.beatMap ? decodeBeatMap(plan.beatMap, plan.durationMs) : null; shell.classList.toggle('hidden', !times); if (!times) return;
  const initial = { effect: plan.cues[0].effect, screenColor: plan.cues[0].screenColor }, table = plan.beatStyleTable?.length ? plan.beatStyleTable : [initial];
  let indices = plan.beatStyles ? decodeBeatStyles(plan.beatStyles, times.length, table) : null; if (!indices) indices = Array(times.length).fill(0);
  if (resetSelection) selectedIndex = Math.min(selectedIndex, times.length - 1);
  const canvas = shell.querySelector('#keyframe-graph'), effectControl = shell.querySelector('#keyframe-property-effect'), colorControl = shell.querySelector('#keyframe-property-color'), lightboxEffects = shell.querySelector('#keyframe-lightbox-effects'), lightboxColor = shell.querySelector('#keyframe-lightbox-color-value'), wheel = shell.querySelector('#keyframe-lightbox-wheel'), marker = wheel.querySelector('span'), saturation = shell.querySelector('#keyframe-lightbox-saturation'), brightness = shell.querySelector('#keyframe-lightbox-brightness'), satOut = shell.querySelector('#keyframe-lightbox-saturation-value'), brightOut = shell.querySelector('#keyframe-lightbox-brightness-value'), list = shell.querySelector('#beats-panel');
  const propertyStyle = styleAt(plan, selectedIndex, table, indices);
  effectControl.replaceChildren(...effects.map(([id, item]) => new Option(item.label, id))); effectControl.value = propertyStyle.effect; colorControl.value = propertyStyle.screenColor; lightboxColor.value = propertyStyle.screenColor;
  lightboxEffects.replaceChildren(...effects.map(([id, item]) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'keyframe-lightbox-chip'; button.textContent = item.label; button.onclick = () => updateStyles(selectedIndex, 'effect', id, table, indices); return button; }));
  const hs = colorHueSaturation(propertyStyle.screenColor), radius = Math.max(1, wheel.clientWidth / 2 - 11); wheel.setAttribute('aria-valuenow', String(Math.round(hs.h))); marker.style.left = `calc(50% + ${Math.cos(hs.h * Math.PI / 180) * radius}px)`; marker.style.top = `calc(50% - ${Math.sin(hs.h * Math.PI / 180) * radius}px)`; marker.style.transform = `translate(-50%,-50%)`;
  saturation.value = String(Math.round(hs.s * 100)); brightness.value = String(Math.round(hs.v * 100)); satOut.value = `${saturation.value}%`; brightOut.value = `${brightness.value}%`;
  const selected = shell.querySelector('#selected-keyframe'), timeLabel = shell.querySelector('#keyframe-property-time'); selected.textContent = `BEAT ${String(selectedIndex + 1).padStart(2, '0')} · ${(times[selectedIndex] / 1000).toFixed(2)} s`; timeLabel.textContent = `At ${(times[selectedIndex] / 1000).toFixed(2)} s`;
  setTab(shell, inspectorTab); drawTimeline(canvas, times, table, indices); renderBeatList(list, times, table, indices); redraw = () => drawTimeline(canvas, times, table, indices);
  shell.querySelectorAll('[data-inspector-tab]').forEach(button => { button.onclick = () => setTab(shell, button.dataset.inspectorTab); });
  const updateSelection = index => { selectedIndex = index; followPlayback = false; const style = styleAt(plan, index, table, indices), color = colorHueSaturation(style.screenColor), r = Math.max(1, wheel.clientWidth / 2 - 11); selected.textContent = `BEAT ${String(index + 1).padStart(2, '0')} · ${(times[index] / 1000).toFixed(2)} s`; timeLabel.textContent = `At ${(times[index] / 1000).toFixed(2)} s`; effectControl.value = style.effect; colorControl.value = style.screenColor; lightboxColor.value = style.screenColor; saturation.value = String(Math.round(color.s * 100)); brightness.value = String(Math.round(color.v * 100)); satOut.value = `${saturation.value}%`; brightOut.value = `${brightness.value}%`; marker.style.left = `calc(50% + ${Math.cos(color.h * Math.PI / 180) * r}px)`; marker.style.top = `calc(50% - ${Math.sin(color.h * Math.PI / 180) * r}px)`; setTab(shell, 'properties'); drawTimeline(canvas, times, table, indices); renderBeatList(list, times, table, indices); };
  effectControl.onchange = () => updateStyles(selectedIndex, 'effect', effectControl.value, table, indices); colorControl.onchange = () => updateStyles(selectedIndex, 'screenColor', colorControl.value, table, indices);
  canvas.onpointerdown = event => { if (event.button !== 0) return; const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top, left = Number(canvas.dataset.left), right = Number(canvas.dataset.right), start = Number(canvas.dataset.start), span = Number(canvas.dataset.span), pageStart = Number(canvas.dataset.pageStart), pageEnd = Number(canvas.dataset.pageEnd), timeAtX = Math.max(0, Math.min(plan.durationMs, start + ((x - left) / Math.max(1, right - left)) * span));
    if (y <= 40) { drag = { kind: 'playhead', pointerId: event.pointerId }; scrubTimeMs = timeAtX; activePlaybackTimeMs = timeAtX; window.dispatchEvent(new CustomEvent('lightsync:timeline-seek', { detail: { timeMs: timeAtX, commit: false } })); drawTimeline(canvas, times, table, indices); }
    else { const candidates = times.slice(pageStart, pageEnd).map((time, i) => ({ index: pageStart + i, x: left + ((time - start) / span) * (right - left) })).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x)); if (!candidates.length) return; updateSelection(candidates[0].index); drag = { kind: 'clip', index: candidates[0].index, pointerId: event.pointerId, moved: false }; }
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => { if (!drag || drag.pointerId !== event.pointerId || !canvas.hasPointerCapture(event.pointerId)) return; const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, left = Number(canvas.dataset.left), right = Number(canvas.dataset.right), start = Number(canvas.dataset.start), span = Number(canvas.dataset.span);
    if (drag.kind === 'playhead') { scrubTimeMs = Math.max(0, Math.min(plan.durationMs, start + ((x - left) / Math.max(1, right - left)) * span)); activePlaybackTimeMs = scrubTimeMs; window.dispatchEvent(new CustomEvent('lightsync:timeline-seek', { detail: { timeMs: scrubTimeMs, commit: false } })); drawTimeline(canvas, times, table, indices); return; }
    const index = drag.index, min = index ? times[index - 1] + 260 : 0, max = index < times.length - 1 ? times[index + 1] - 260 : plan.durationMs - 20, raw = start + ((x - left) / Math.max(1, right - left)) * span, next = Math.max(min, Math.min(max, Math.round(raw / 20) * 20)); if (next === times[index]) return; times[index] = next; drag.moved = true; drawTimeline(canvas, times, table, indices);
  };
  const finishDrag = event => { if (!drag || drag.pointerId !== event.pointerId) return; const completed = drag; drag = null; if (completed.kind === 'playhead') { window.dispatchEvent(new CustomEvent('lightsync:timeline-seek', { detail: { timeMs: activePlaybackTimeMs, commit: true } })); scrubTimeMs = null; drawTimeline(canvas, times, table, indices); } else if (completed.moved) { const beatMap = encodeBeatMap(times); if (beatMap) activeUpdate(plan.beatStyles || indices.map(value => alphabet[value]).join(''), table, beatMap); } };
  canvas.onpointerup = finishDrag; canvas.onpointercancel = finishDrag; canvas.onlostpointercapture = finishDrag;
  let wheelPointer = null, pendingColor = propertyStyle.screenColor, wheelHue = hs.h;
  const placeMarker = h => { const r = Math.max(1, wheel.clientWidth / 2 - 7); marker.style.left = `calc(50% + ${Math.cos(h * Math.PI / 180) * r}px)`; marker.style.top = `calc(50% - ${Math.sin(h * Math.PI / 180) * r}px)`; wheel.setAttribute('aria-valuenow', String(Math.round(h))); };
  const getWheelColor = () => hueColor(wheelHue, Number(saturation.value) / 100, Number(brightness.value) / 100);
  const moveWheel = event => { const rect = wheel.getBoundingClientRect(), dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2; if (Math.hypot(dx, dy) > 1) wheelHue = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360; pendingColor = getWheelColor(); lightboxColor.value = pendingColor; placeMarker(wheelHue); };
  wheel.onpointerdown = event => { const rect = wheel.getBoundingClientRect(), dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2; if (Math.hypot(dx, dy) < rect.width / 2 - 20) return; wheelPointer = event.pointerId; wheel.setPointerCapture(event.pointerId); moveWheel(event); };
  wheel.onpointermove = event => { if (wheelPointer === event.pointerId) moveWheel(event); }; const endWheel = event => { if (wheelPointer !== event.pointerId) return; wheelPointer = null; updateStyles(selectedIndex, 'screenColor', pendingColor, table, indices); }; wheel.onpointerup = endWheel; wheel.onpointercancel = endWheel;
  wheel.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); wheelHue = (wheelHue + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? 358 : 2)) % 360; pendingColor = getWheelColor(); lightboxColor.value = pendingColor; placeMarker(wheelHue); updateStyles(selectedIndex, 'screenColor', pendingColor, table, indices); };
  const syncSliders = () => { const color = colorHueSaturation(lightboxColor.value); wheelHue = color.h; saturation.value = String(Math.round(color.s * 100)); brightness.value = String(Math.round(color.v * 100)); satOut.value = `${saturation.value}%`; brightOut.value = `${brightness.value}%`; placeMarker(color.h); };
  lightboxColor.onchange = () => { pendingColor = lightboxColor.value; syncSliders(); updateStyles(selectedIndex, 'screenColor', pendingColor, table, indices); };
  const updateWheelSliders = () => { pendingColor = getWheelColor(); lightboxColor.value = pendingColor; satOut.value = `${saturation.value}%`; brightOut.value = `${brightness.value}%`; placeMarker(wheelHue); };
  saturation.oninput = brightness.oninput = updateWheelSliders; saturation.onchange = brightness.onchange = () => updateStyles(selectedIndex, 'screenColor', pendingColor, table, indices);
  const follow = shell.querySelector('#beat-follow'); follow.onclick = () => { followPlayback = !followPlayback; if (followPlayback && activePlaybackIndex >= 0) selectedIndex = activePlaybackIndex; drawTimeline(canvas, times, table, indices); };
  if (resizeObserver) resizeObserver.disconnect(); resizeObserver = new ResizeObserver(() => drawTimeline(canvas, times, table, indices)); resizeObserver.observe(canvas.parentElement);
}
let resizeObserver = null;
export function setKeyframePlaybackTime(elapsedMs) {
  activePlaybackTimeMs = Number.isFinite(elapsedMs) ? elapsedMs : null;
  if (!activePlan?.beatMap || elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= activePlan.durationMs) { if (activePlaybackIndex !== -1 || activePlaybackTimeMs !== null) { activePlaybackIndex = -1; activePlaybackTimeMs = null; redraw?.(); } return; }
  const times = decodeBeatMap(activePlan.beatMap, activePlan.durationMs); if (!times) return; let low = 0, high = times.length; while (low < high) { const middle = (low + high) >> 1; if (times[middle] <= elapsedMs) low = middle + 1; else high = middle; } const next = low - 1; if (next !== activePlaybackIndex) { activePlaybackIndex = next; redraw?.(); }
}
export { renderKeyframeEditor };
window.addEventListener('crowdsync:theme', () => redraw?.());
