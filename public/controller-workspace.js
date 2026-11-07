const STORAGE_KEY = 'crowdsync.controller.workspace.v2';
const LAYOUT_PRESETS_KEY = 'crowdsync.controller.workspace-presets.v1';
const THEME_KEY = 'crowdsync.controller.theme.v1';
const PERFORMANCE_KEY = 'crowdsync.controller.performance.v1';
try { localStorage.removeItem('crowdsync.community-look-packs.v1'); } catch {}
const ICONS = {
  minimize: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11.5h10"/></svg>',
  restore: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h8v8H4z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>',
};
const roots = [...document.querySelectorAll('[data-workspace-grid]')];
const prefsButton = document.querySelector('#controller-preferences');
const preferenceDialog = document.createElement('dialog');
preferenceDialog.className = 'controller-preferences-dialog';
preferenceDialog.setAttribute('aria-labelledby', 'controller-preferences-title');
preferenceDialog.innerHTML = '<form method="dialog"><header><div><div class="eyebrow">PRODUCTION DESK</div><h2 id="controller-preferences-title">Workspace preferences</h2></div><button class="square-icon" value="close" aria-label="Close preferences"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg></button></header><p class="preferences-copy">Arrange the control desk for this device. Window layouts and appearance are saved locally.</p><section class="preference-section workspace-layout-section"><h3>Saved workspace layouts</h3><p class="small-copy">Save window positions, sizes, visibility and arrangement for reuse on another show.</p><div class="workspace-layout-save-row"><input id="workspace-layout-name" maxlength="40" placeholder="Name this layout" aria-label="Workspace layout name"><button id="save-workspace-layout" class="button button-secondary" type="button">Save current</button></div><div class="workspace-layout-load-row"><select id="workspace-layout-select" aria-label="Saved workspace layouts"><option value="">No saved layouts</option></select><button id="load-workspace-layout" class="button button-secondary" type="button" disabled>Load</button><button id="delete-workspace-layout" class="button button-quiet" type="button" disabled>Delete</button></div><p id="workspace-layout-status" class="small-copy" aria-live="polite"></p></section><section class="preference-section"><h3>Theme</h3><div class="preference-choice-row"><button type="button" data-theme-choice="dark">Dark</button><button type="button" data-theme-choice="light">Light</button></div></section><section class="preference-section"><label class="preference-switch"><span><strong>Performance mode</strong><small>Reduce background movement and interface transitions.</small></span><input id="performance-mode" type="checkbox"><i aria-hidden="true"></i></label></section><section class="preference-section"><h3>Workspace windows</h3><div class="workspace-window-list"></div><button class="button button-secondary restore-all" type="button">Restore all windows</button><button class="button button-quiet reset-layout" type="button">Reset layout and preferences</button></section></form>';
document.body.append(preferenceDialog);
const contextMenu = document.createElement('div');
contextMenu.className = 'workspace-context-menu hidden';
contextMenu.setAttribute('role', 'menu');
contextMenu.innerHTML = '<button type="button" role="menuitem" data-action="hide">Hide this window</button><button type="button" role="menuitem" data-action="restore">Restore all windows</button>';
document.body.append(contextMenu);
const addWindowButton = document.createElement('button');
addWindowButton.className = 'workspace-add-button';
addWindowButton.type = 'button';
addWindowButton.setAttribute('aria-label', 'Add a workspace window');
addWindowButton.title = 'Add window';
addWindowButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
document.body.append(addWindowButton);
const addWindowDialog = document.createElement('dialog');
addWindowDialog.className = 'add-window-dialog';
addWindowDialog.setAttribute('aria-labelledby', 'add-window-title');
addWindowDialog.innerHTML = '<header><div><div class="eyebrow">WORKSPACE</div><h2 id="add-window-title">Add a window</h2></div><button class="square-icon" value="close" formmethod="dialog" aria-label="Close window picker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg></button></header><p>Drag a title bar to snap windows into place. Hold Shift while dragging to place a window freely over the canvas and other windows. Resize from a lower corner or hide a window with right-click.</p><div class="add-window-options"><button type="button" data-add-window="sync-check"><strong>Sync check</strong><small>Manage the audience timing test.</small></button><button type="button" data-add-window="join-code"><strong>Room code &amp; QR</strong><small>Share the room with guests.</small></button><button type="button" data-add-window="effect-library"><strong>Effects library</strong><small>Choose and preview built-in looks.</small></button><button type="button" data-add-window="cue-sheet"><strong>Songs &amp; beat cues</strong><small>Upload local audio and edit detected beats.</small></button><button type="button" data-add-window="crowd-preview"><strong>Audience preview</strong><small>Preview the selected show output.</small></button><button type="button" data-add-window="show-controls"><strong>Live controls</strong><small>Transport, output and audience messaging.</small></button><button type="button" data-add-window="show-activity"><strong>Show activity</strong><small>Recent room events and connection status.</small></button></div>';
document.body.append(addWindowDialog);
const consoleView = document.querySelector('#console');
function updateAddButtonVisibility() { addWindowButton.classList.toggle('hidden', !!consoleView?.classList.contains('hidden')); }
updateAddButtonVisibility();
if (consoleView) new MutationObserver(updateAddButtonVisibility).observe(consoleView, { attributes: true, attributeFilter: ['class'] });

let draggedWindow = null;
let activeMenuWindow = null;
let pointerOrigin = null;
let movingWindow = null;
let dragSlot = null;
let snapTarget = null;
let resizeState = null;
const defaultOrders = new Map();
const defaultHidden = new Map();
let workspaceState = readWorkspace();

function readWorkspace() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}
function readWorkspacePresets() {
  try {
    const value = JSON.parse(localStorage.getItem(LAYOUT_PRESETS_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim() && item.name.length <= 40 && item.state && typeof item.state === 'object').slice(0, 20);
  } catch { return []; }
}
let workspacePresets = readWorkspacePresets();
function saveWorkspace() {
  workspaceState = Object.fromEntries(roots.map((root) => [root.dataset.workspaceGrid, {
    order: [...root.querySelectorAll(':scope > .workspace-window')].map((node) => node.dataset.windowId),
    hidden: [...root.querySelectorAll(':scope > .workspace-window.is-hidden-window')].map((node) => node.dataset.windowId),
    minimized: [...root.querySelectorAll(':scope > .workspace-window.is-minimized-window')].map((node) => node.dataset.windowId),
    free: Object.fromEntries([...root.querySelectorAll(':scope > .workspace-window.is-free-window')].map((node) => [node.dataset.windowId, {
      x: Number(node.dataset.freeX) || 0, y: Number(node.dataset.freeY) || 0, width: Number(node.dataset.freeWidth) || node.getBoundingClientRect().width,
    }])),
    sizes: Object.fromEntries([...root.querySelectorAll(':scope > .workspace-window[data-window-columns], :scope > .workspace-window[data-window-width], :scope > .workspace-window[data-window-height]')].map((node) => [node.dataset.windowId, {
      columns: Number(node.dataset.windowColumns) || null, width: Number(node.dataset.windowWidth) || null, height: Number(node.dataset.windowHeight) || null,
    }])),
  }]));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaceState)); } catch {}
  renderWindowSettings();
}
function applyWorkspaceSnapshot(snapshot) {
  for (const root of roots) {
    const saved = snapshot?.[root.dataset.workspaceGrid] || {};
    const cards = [...root.querySelectorAll(':scope > .workspace-window')];
    const byId = new Map(cards.map((card) => [card.dataset.windowId, card]));
    const ordered = [], seen = new Set();
    for (const id of Array.isArray(saved.order) ? saved.order : []) if (byId.has(id) && !seen.has(id)) { ordered.push(byId.get(id)); seen.add(id); }
    for (const card of cards) if (!seen.has(card.dataset.windowId)) ordered.push(card);
    ordered.forEach((card) => root.append(card));
    for (const card of cards) {
      card.classList.remove('is-hidden-window', 'is-minimized-window', 'is-resized-window');
      updateMinimizeControl(card, false);
      card.removeAttribute('data-window-columns'); card.removeAttribute('data-window-width'); card.removeAttribute('data-window-height');
      card.style.removeProperty('--window-columns'); card.style.removeProperty('--window-width'); card.style.removeProperty('--window-height');
      clearFreePosition(card);
    }
    for (const id of saved.hidden || []) byId.get(id)?.classList.add('is-hidden-window');
    for (const id of saved.minimized || []) { const card = byId.get(id); if (card) { card.classList.add('is-minimized-window'); updateMinimizeControl(card, true); } }
    for (const [id, size] of Object.entries(saved.sizes || {})) {
      const card = byId.get(id); if (!card) continue;
      if (Number.isInteger(size.columns) && size.columns >= 2 && size.columns <= 12) setWindowColumns(card, size.columns);
      if (Number.isInteger(size.width) && size.width >= 280 && size.width <= 2400) setWindowWidth(card, size.width);
      if (Number.isInteger(size.height) && size.height >= 192 && size.height <= 1024) setWindowHeight(card, size.height);
    }
    for (const [id, position] of Object.entries(saved.free || {})) {
      const card = byId.get(id); if (!card || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) continue;
      setFreePosition(card, Math.max(0, position.x), Math.max(0, position.y), Math.max(280, Number(position.width) || card.getBoundingClientRect().width));
    }
  }
  contextMenu.classList.add('hidden'); saveWorkspace();
}
function labelFor(card) {
  const labels = [
    ['audience-setup-card', 'AUDIENCE SYNC'], ['join-card', 'JOIN CODE'],
    ['crowd-preview-card', 'CROWD MONITOR'], ['effects-card', 'LIGHT DESIGN'], ['effect-graph-card', 'EFFECT NODES'],
    ['cue-builder-card', 'BEAT SEQUENCER'],
    ['live-controls-card', 'LIVE CONSOLE'], ['activity-card', 'ROOM ACTIVITY'],
  ];
  return labels.find(([className]) => card.classList.contains(className))?.[1]
    || card.querySelector('h2,h3')?.textContent?.trim() || 'Workspace window';
}
function addWindowBar(card) {
  const existing = [...card.querySelectorAll(':scope > .workspace-windowbar')];
  if (existing.length) {
    const keep = existing.find((bar) => bar.querySelector('.workspace-window-title')?.textContent.trim()) || existing[0];
    for (const bar of existing) if (bar !== keep) bar.remove();
    const title = keep.querySelector('.workspace-window-title');
    if (title) title.textContent = labelFor(card);
    return;
  }
  const label = labelFor(card);
  const bar = document.createElement('div');
  bar.className = 'workspace-windowbar';
  bar.title = 'Drag to snap · hold Shift to place freely over other windows';
  bar.innerHTML = `<span class="workspace-window-title"></span><div class="workspace-window-controls"><button class="workspace-minimize" type="button" aria-label="Minimize ${label}" aria-expanded="true" title="Minimize">${ICONS.minimize}</button><button class="workspace-hide" type="button" aria-label="Close ${label}" title="Close window">${ICONS.close}</button></div>`;
  bar.querySelector('.workspace-window-title').textContent = label;
  bar.addEventListener('pointerdown', startDrag);
  bar.querySelector('.workspace-minimize').addEventListener('click', () => toggleMinimize(card));
  bar.querySelector('.workspace-hide').addEventListener('click', () => hideWindow(card));
  card.prepend(bar);
  const resizeHandle = document.createElement('button');
  resizeHandle.className = 'workspace-resize-handle'; resizeHandle.type = 'button';
  resizeHandle.setAttribute('aria-label', `Resize ${label}`); resizeHandle.title = 'Drag to resize';
  resizeHandle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 15 15 5M9 15l6-6M13 15l2-2"/></svg>';
  const sizeReadout = document.createElement('output');
  sizeReadout.className = 'workspace-size-readout'; sizeReadout.setAttribute('aria-live', 'polite'); sizeReadout.setAttribute('aria-hidden', 'true');
  card.append(sizeReadout);
  resizeHandle.addEventListener('pointerdown', startResize); card.append(resizeHandle);
  card.classList.add('workspace-window');
  card.dataset.windowLabel = label;
}
function setupRoots() {
  for (const root of roots) {
    const children = root.dataset.workspaceGrid === 'show'
      ? [...root.querySelectorAll('.show-editor-grid > .card'), ...root.querySelectorAll(':scope > .card')]
      : [...root.querySelectorAll(':scope > .card')];
    for (const card of children) {
      // A stale or repeated workspace bootstrap can leave duplicate chrome on
      // an existing card. Normalize it before the ready guard so reloads repair
      // old DOM instead of preserving stacked title bars indefinitely.
      const bars = [...card.querySelectorAll(':scope > .workspace-windowbar')];
      if (bars.length) {
        const keep = bars.find((bar) => bar.querySelector('.workspace-window-title')?.textContent.trim()) || bars[0];
        for (const bar of bars) if (bar !== keep) bar.remove();
        const title = keep.querySelector('.workspace-window-title');
        if (title) title.textContent = labelFor(card);
      }
      for (const selector of ['.workspace-resize-handle', '.workspace-size-readout']) {
        const duplicates = [...card.querySelectorAll(`:scope > ${selector}`)];
        for (const element of duplicates.slice(1)) element.remove();
      }
      if (card.dataset.workspaceReady) continue;
      const id = card.classList.contains('audience-setup-card') ? 'sync-check'
        : card.classList.contains('join-card') ? 'join-code'
          : card.classList.contains('crowd-preview-card') ? 'crowd-preview'
              : card.classList.contains('effects-card') ? 'effect-library'
                : card.classList.contains('effect-graph-card') ? 'effect-nodes'
              : card.classList.contains('cue-builder-card') ? 'cue-sheet'
                : card.classList.contains('live-controls-card') ? 'show-controls'
                  : card.classList.contains('activity-card') ? 'show-activity' : `window-${children.indexOf(card)}`;
      card.dataset.windowId = id;
      card.dataset.workspaceReady = 'true';
      addWindowBar(card);
      if (root.dataset.workspaceGrid === 'show' && card.parentElement !== root) root.append(card);
      card.addEventListener('pointerdown', () => {
        if (!card.classList.contains('is-free-window') || card.parentElement !== root) return;
        root.append(card); saveWorkspace();
      });
      card.addEventListener('contextmenu', (event) => {
        if (event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
        event.preventDefault(); activeMenuWindow = card;
        contextMenu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - 190))}px`;
        contextMenu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - 94))}px`;
        contextMenu.classList.remove('hidden');
      });
    }
    if (root.dataset.workspaceGrid === 'show') children.forEach((card) => root.append(card));
    root.classList.add('workspace-grid');
    defaultOrders.set(root.dataset.workspaceGrid, [...root.querySelectorAll(':scope > .workspace-window')].map((node) => node.dataset.windowId));
    defaultHidden.set(root.dataset.workspaceGrid, [...root.querySelectorAll(':scope > .workspace-window.is-hidden-window')].map((node) => node.dataset.windowId));
    const saved = workspaceState[root.dataset.workspaceGrid];
    if (saved?.order?.length) {
      const byId = new Map([...root.querySelectorAll(':scope > .workspace-window')].map((node) => [node.dataset.windowId, node]));
      const ordered = [], seen = new Set();
      for (const id of Array.isArray(saved.order) ? saved.order : []) if (byId.has(id) && !seen.has(id)) { ordered.push(byId.get(id)); seen.add(id); }
      for (const [id, card] of byId) if (!seen.has(id)) ordered.push(card);
      ordered.forEach((card) => root.append(card));
    }
    for (const id of saved?.hidden || []) root.querySelector(`:scope > [data-window-id="${CSS.escape(id)}"]`)?.classList.add('is-hidden-window');
    for (const id of saved?.minimized || []) {
      const card = root.querySelector(`:scope > [data-window-id="${CSS.escape(id)}"]`);
      if (card) { card.classList.add('is-minimized-window'); updateMinimizeControl(card, true); }
    }
    for (const [id, size] of Object.entries(saved?.sizes || {})) {
      const card = root.querySelector(`:scope > [data-window-id="${CSS.escape(id)}"]`);
      if (!card) continue;
      if (Number.isInteger(size.columns) && size.columns >= 2 && size.columns <= 12) setWindowColumns(card, size.columns);
      if (Number.isInteger(size.width) && size.width >= 280 && size.width <= 2400) setWindowWidth(card, size.width);
      if (Number.isInteger(size.height) && size.height >= 192 && size.height <= 1024) setWindowHeight(card, size.height);
    }
    for (const [id, position] of Object.entries(saved?.free || {})) {
      const card = root.querySelector(`:scope > [data-window-id="${CSS.escape(id)}"]`);
      if (!card || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) continue;
      setFreePosition(card, Math.max(0, position.x), Math.max(0, position.y), Math.max(280, Number(position.width) || card.getBoundingClientRect().width));
    }
  }
  saveWorkspace();
}
function updateDragField(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--pointer-x', `${event.clientX - bounds.left}px`);
  event.currentTarget.style.setProperty('--pointer-y', `${event.clientY - bounds.top}px`);
}
function defaultColumns(card) {
  if (card.classList.contains('cue-builder-card') || card.classList.contains('effect-graph-card')) return 12;
  if (card.classList.contains('audience-setup-card') || card.classList.contains('live-controls-card')) return 8;
  if (card.classList.contains('join-card') || card.classList.contains('activity-card')) return 4;
  if (card.classList.contains('crowd-preview-card')) return 7;
  if (card.classList.contains('effects-card')) return 5;
  return 6;
}
function setWindowColumns(card, columns) {
  card.dataset.windowColumns = String(columns);
  card.style.setProperty('--window-columns', String(columns));
  clearWindowWidth(card);
}
function setWindowWidth(card, width) {
  card.removeAttribute('data-window-columns'); card.style.removeProperty('--window-columns');
  card.dataset.windowWidth = String(Math.round(width));
  card.style.setProperty('--window-width', `${Math.round(width)}px`);
}
function clearWindowWidth(card) { delete card.dataset.windowWidth; card.style.removeProperty('--window-width'); }
function setWindowHeight(card, height) {
  card.dataset.windowHeight = String(height);
  card.style.setProperty('--window-height', `${height}px`);
}
function snapToGrid(value, step, min, max) {
  const minSnap = Math.ceil(min / step) * step;
  const maxSnap = Math.floor(max / step) * step;
  return Math.max(minSnap, Math.min(maxSnap, Math.round(value / step) * step));
}
function updateResizeReadout(state = resizeState) {
  if (!state?.card || !state.readout) return;
  const rect = state.card.getBoundingClientRect();
  const width = Math.round(rect.width), height = Math.round(rect.height);
  const columns = Number(state.card.dataset.windowColumns) || state.gridColumns;
  const free = state.card.classList.contains('is-free-window');
  const pixelWidth = state.responsive || free || !!state.card.dataset.windowWidth;
  state.readout.textContent = `${free ? 'FREE' : pixelWidth ? 'GRID' : `${columns} COL`} · ${width} × ${height} px`;
}
function setFreePosition(card, x, y, width) {
  card.classList.add('is-free-window');
  card.dataset.freeX = String(Math.round(x)); card.dataset.freeY = String(Math.round(y)); card.dataset.freeWidth = String(Math.round(width));
  card.style.setProperty('--free-left', `${Math.round(x)}px`); card.style.setProperty('--free-top', `${Math.round(y)}px`); card.style.setProperty('--free-width', `${Math.round(width)}px`);
}
function clearFreePosition(card) {
  card.classList.remove('is-free-window');
  for (const key of ['freeX','freeY','freeWidth']) delete card.dataset[key];
  for (const property of ['--free-left','--free-top','--free-width']) card.style.removeProperty(property);
}
function captureLayout(root) {
  return new Map([...root.querySelectorAll(':scope > .workspace-window:not(.is-hidden-window)')].map((node) => [node, node.getBoundingClientRect()]));
}
function animateReflow(root, before) {
  requestAnimationFrame(() => {
    const changes = [];
    for (const [node, oldRect] of before) {
      if (!node.isConnected || node.parentElement !== root) continue;
      const next = node.getBoundingClientRect(), dx = oldRect.left - next.left, dy = oldRect.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      node.style.transition = 'none'; node.style.transform = `translate(${dx}px,${dy}px)`; node.style.filter = 'blur(.8px)'; changes.push(node);
    }
    if (!changes.length) return;
    root.getBoundingClientRect();
    requestAnimationFrame(() => changes.forEach((node) => {
      node.style.transition = 'transform 260ms cubic-bezier(.16,1,.3,1), filter 190ms ease-out';
      node.style.transform = ''; node.style.filter = '';
      setTimeout(() => { node.style.transition = ''; }, 280);
    }));
  });
}
function startDrag(event) {
  if (event.button !== 0 || !event.isPrimary || event.target.closest('button') || resizeState || draggedWindow) return;
  const card = event.currentTarget.closest('.workspace-window');
  if (!card) return;
  event.preventDefault(); movingWindow = card; card.classList.add('is-window-held');
  const rect = card.getBoundingClientRect();
  pointerOrigin = { x: event.clientX, y: event.clientY, id: event.pointerId, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top, rect };
  event.currentTarget.setPointerCapture(event.pointerId);
  document.addEventListener('pointermove', dragMove);
  document.addEventListener('pointerup', endDrag, { once: true });
  document.addEventListener('pointercancel', endDrag, { once: true });
}
function startResize(event) {
  if (event.button !== 0 || !event.isPrimary || resizeState || draggedWindow) return;
  const card = event.currentTarget.closest('.workspace-window'), root = card?.closest('.workspace-grid');
  if (!card || !root) return;
  event.preventDefault(); event.stopPropagation();
  const rect = card.getBoundingClientRect(), columns = Number(card.dataset.windowColumns) || defaultColumns(card);
  const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 0;
  const gridColumns = getComputedStyle(root).gridTemplateColumns.split(' ').length || 12;
  resizeState = { card, root, readout: card.querySelector('.workspace-size-readout'), id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, columns, gridColumns, responsive: innerWidth <= 860, columnWidth: (root.clientWidth - gap * (gridColumns - 1)) / gridColumns + gap };
  card.classList.add('is-resizing-window', 'is-window-held'); resizeState.readout?.setAttribute('aria-hidden', 'false'); updateResizeReadout(); event.currentTarget.setPointerCapture(event.pointerId);
  document.addEventListener('pointermove', resizeMove);
  document.addEventListener('pointerup', endResize, { once: true });
  document.addEventListener('pointercancel', endResize, { once: true });
}
function resizeMove(event) {
  if (!resizeState || event.pointerId !== resizeState.id) return;
  const { card, root, x, y, width, height, columns, gridColumns, responsive, columnWidth } = resizeState;
  const free = card.classList.contains('is-free-window');
  if (free) {
    const left = Number(card.dataset.freeX) || 0, maxWidth = Math.max(280, root.clientWidth - left);
    setFreePosition(card, left, Number(card.dataset.freeY) || 0, snapToGrid(width + event.clientX - x, 32, 280, maxWidth));
  } else if (responsive) {
    setWindowWidth(card, snapToGrid(width + event.clientX - x, 32, 280, Math.max(280, root.clientWidth)));
  } else {
    const nextColumns = Math.max(2, Math.min(gridColumns, columns + Math.round((event.clientX - x) / Math.max(1, columnWidth))));
    setWindowColumns(card, nextColumns);
  }
  const maxHeight = Math.max(192, Math.min(1024, root.clientHeight - (Number(card.dataset.freeY) || 0)));
  setWindowHeight(card, snapToGrid(height + event.clientY - y, 32, 192, maxHeight));
  root.classList.add('is-resizing'); updateResizeReadout();
}
function endResize() {
  document.removeEventListener('pointermove', resizeMove);
  document.removeEventListener('pointerup', endResize); document.removeEventListener('pointercancel', endResize);
  if (resizeState) {
    const { card, root, readout } = resizeState;
    card.classList.remove('is-resizing-window', 'is-window-held'); card.classList.add('is-window-releasing');
    root.classList.remove('is-resizing'); readout.setAttribute('aria-hidden', 'true');
    setTimeout(() => card.classList.remove('is-window-releasing'), 380); saveWorkspace();
  }
  resizeState = null;
}
function targetAtPoint(root, x, y) {
  const hovered = document.elementFromPoint(x, y)?.closest('.workspace-window');
  if (hovered && hovered.parentElement === root && !hovered.classList.contains('is-hidden-window')) return hovered;
  let best = null, distance = Infinity;
  for (const node of root.querySelectorAll(':scope > .workspace-window:not(.is-hidden-window)')) {
    const rect = node.getBoundingClientRect(), dx = Math.max(rect.left - x, 0, x - rect.right), dy = Math.max(rect.top - y, 0, y - rect.bottom), d = Math.hypot(dx, dy);
    if (d < distance) { distance = d; best = node; }
  }
  return distance <= 96 ? best : null;
}
function dragMove(event) {
  if (!movingWindow || !pointerOrigin || event.pointerId !== pointerOrigin.id) return;
  if (!draggedWindow && Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y) > 7) {
    draggedWindow = movingWindow;
    const root = draggedWindow.parentElement, before = captureLayout(root), rect = pointerOrigin.rect;
    dragSlot = document.createElement('div'); dragSlot.className = 'workspace-snap-slot';
    dragSlot.style.gridColumn = getComputedStyle(draggedWindow).gridColumn; dragSlot.style.height = `${rect.height}px`;
    root.insertBefore(dragSlot, draggedWindow);
    draggedWindow.classList.remove('is-free-window');
    document.body.append(draggedWindow);
    draggedWindow.classList.add('is-dragging-window');
    Object.assign(draggedWindow.style, { position: 'fixed', zIndex: '1000', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', pointerEvents: 'none', overflow: 'hidden' });
    root.classList.add('is-dragging'); animateReflow(root, before);
  }
  if (!draggedWindow) return;
  const root = dragSlot?.parentElement;
  if (!root) return;
  root.classList.toggle('is-free-dragging', event.shiftKey);
  draggedWindow.style.left = `${event.clientX - pointerOrigin.grabX}px`;
  draggedWindow.style.top = `${event.clientY - pointerOrigin.grabY}px`;
  updateDragField({ currentTarget: root, clientX: event.clientX, clientY: event.clientY });
  const candidate = event.shiftKey ? null : targetAtPoint(root, event.clientX, event.clientY);
  if (candidate !== snapTarget) { snapTarget?.classList.remove('workspace-snap-preview'); snapTarget = candidate; snapTarget?.classList.add('workspace-snap-preview'); }
  if (!candidate) return;
  const rect = candidate.getBoundingClientRect(), horizontal = Math.abs(event.clientX - (rect.left + rect.width / 2)) > Math.abs(event.clientY - (rect.top + rect.height / 2));
  const before = horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2;
  const anchor = before ? candidate : candidate.nextElementSibling;
  if (anchor !== dragSlot && anchor !== dragSlot?.nextElementSibling) {
    const old = captureLayout(root);
    if (anchor) root.insertBefore(dragSlot, anchor); else root.append(dragSlot);
    animateReflow(root, old);
  }
}
function endDrag(event) {
  document.removeEventListener('pointermove', dragMove);
  document.removeEventListener('pointerup', endDrag); document.removeEventListener('pointercancel', endDrag);
  if (draggedWindow) {
    const root = dragSlot?.parentElement, before = root ? captureLayout(root) : new Map();
    snapTarget?.classList.remove('workspace-snap-preview'); snapTarget = null;
    const freeDrop = !!(event?.shiftKey && root);
    const freeRect = freeDrop ? draggedWindow.getBoundingClientRect() : null;
    const rootRect = freeDrop ? root.getBoundingClientRect() : null;
    for (const prop of ['position','zIndex','left','top','width','height','margin','pointerEvents','overflow']) draggedWindow.style.removeProperty(prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
    draggedWindow.classList.remove('is-dragging-window');
    if (freeDrop) {
      dragSlot?.remove(); root.append(draggedWindow);
      setFreePosition(draggedWindow, freeRect.left - rootRect.left - root.clientLeft + root.scrollLeft, freeRect.top - rootRect.top - root.clientTop + root.scrollTop, freeRect.width);
    } else {
      clearFreePosition(draggedWindow);
      if (dragSlot?.parentElement) dragSlot.replaceWith(draggedWindow);
    }
    const droppedWindow = draggedWindow; droppedWindow.classList.remove('is-window-held'); droppedWindow.classList.add('is-dropping-window', 'is-window-releasing'); setTimeout(() => droppedWindow.classList.remove('is-dropping-window', 'is-window-releasing'), 380);
    root?.classList.remove('is-dragging');
    root?.classList.remove('is-free-dragging');
    if (root) animateReflow(root, before);
    saveWorkspace();
  }
  if (movingWindow) {
    const releasedWindow = movingWindow;
    releasedWindow.classList.remove('is-window-held'); releasedWindow.classList.add('is-window-releasing');
    setTimeout(() => releasedWindow.classList.remove('is-window-releasing'), 380);
  }
  draggedWindow = null; movingWindow = null; pointerOrigin = null; dragSlot = null;
}
function cancelWorkspaceGesture() {
  if (movingWindow || draggedWindow) endDrag();
  if (resizeState) endResize();
}
function hideWindow(card) {
  card.classList.remove('is-minimized-window'); updateMinimizeControl(card, false); card.classList.add('is-hidden-window'); contextMenu.classList.add('hidden'); saveWorkspace();
}
function updateMinimizeControl(card, minimized) {
  const button = card.querySelector('.workspace-minimize');
  if (!button) return;
  const label = card.dataset.windowLabel;
  button.setAttribute('aria-label', `${minimized ? 'Restore' : 'Minimize'} ${label}`);
  button.setAttribute('aria-expanded', String(!minimized));
  button.title = minimized ? 'Restore window' : 'Minimize';
  button.innerHTML = minimized ? ICONS.restore : ICONS.minimize;
}
function toggleMinimize(card) {
  const minimized = card.classList.toggle('is-minimized-window');
  updateMinimizeControl(card, minimized);
  saveWorkspace();
}
function restoreWindows() {
  document.querySelectorAll('.is-hidden-window,.is-minimized-window').forEach((node) => {
    node.classList.remove('is-hidden-window', 'is-minimized-window'); updateMinimizeControl(node, false);
  });
  contextMenu.classList.add('hidden'); saveWorkspace();
}
function renderWindowSettings() {
  const list = preferenceDialog.querySelector('.workspace-window-list');
  if (!list) return;
  list.replaceChildren();
  for (const root of roots) {
    const group = document.createElement('div'); group.className = 'workspace-preference-group';
    const heading = document.createElement('h4'); heading.textContent = root.dataset.workspaceGrid; group.append(heading);
    for (const card of root.querySelectorAll(':scope > .workspace-window')) {
      const label = document.createElement('label'); label.className = 'workspace-preference-item';
      const name = document.createElement('span'); name.textContent = card.dataset.windowLabel;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !card.classList.contains('is-hidden-window');
      checkbox.setAttribute('aria-label', `Show ${card.dataset.windowLabel}`);
      checkbox.addEventListener('change', () => { card.classList.toggle('is-hidden-window', !checkbox.checked); saveWorkspace(); });
      label.append(name, checkbox); group.append(label);
    }
    list.append(group);
  }
}
function renderWorkspacePresets(selectedId = '') {
  const select = preferenceDialog.querySelector('#workspace-layout-select');
  if (!select) return;
  select.replaceChildren(new Option(workspacePresets.length ? 'Choose a saved layout' : 'No saved layouts', ''));
  for (const preset of workspacePresets) select.add(new Option(preset.name, preset.id));
  if (workspacePresets.some((preset) => preset.id === selectedId)) select.value = selectedId;
  preferenceDialog.querySelector('#load-workspace-layout').disabled = !select.value;
  preferenceDialog.querySelector('#delete-workspace-layout').disabled = !select.value;
}
function saveWorkspacePreset() {
  const input = preferenceDialog.querySelector('#workspace-layout-name'), name = input.value.trim();
  const status = preferenceDialog.querySelector('#workspace-layout-status');
  if (!name) { status.textContent = 'Enter a name for this layout.'; input.focus(); return; }
  saveWorkspace();
  const preset = { id: crypto.randomUUID(), name: name.slice(0, 40), state: JSON.parse(JSON.stringify(workspaceState)) };
  workspacePresets = [preset, ...workspacePresets.filter((item) => item.name.toLocaleLowerCase() !== preset.name.toLocaleLowerCase())].slice(0, 20);
  try { localStorage.setItem(LAYOUT_PRESETS_KEY, JSON.stringify(workspacePresets)); renderWorkspacePresets(preset.id); status.textContent = `“${preset.name}” saved for this browser.`; input.value = ''; }
  catch { status.textContent = 'This browser could not save the layout.'; }
}
function loadWorkspacePreset() {
  const id = preferenceDialog.querySelector('#workspace-layout-select').value, preset = workspacePresets.find((item) => item.id === id);
  if (!preset) return;
  applyWorkspaceSnapshot(preset.state);
  preferenceDialog.querySelector('#workspace-layout-status').textContent = `“${preset.name}” applied.`;
}
function deleteWorkspacePreset() {
  const id = preferenceDialog.querySelector('#workspace-layout-select').value;
  if (!id) return;
  workspacePresets = workspacePresets.filter((item) => item.id !== id);
  try { localStorage.setItem(LAYOUT_PRESETS_KEY, JSON.stringify(workspacePresets)); } catch {}
  renderWorkspacePresets(); preferenceDialog.querySelector('#workspace-layout-status').textContent = 'Saved layout deleted.';
}
function setTheme(theme) {
  document.body.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  preferenceDialog.querySelectorAll('[data-theme-choice]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = theme === 'light' ? '#f2f1ec' : '#090909';
  window.dispatchEvent(new Event('crowdsync:theme'));
}
function setPerformanceMode(enabled) {
  document.body.dataset.performance = enabled ? 'reduced' : 'full';
  preferenceDialog.querySelector('#performance-mode').checked = enabled;
  try { localStorage.setItem(PERFORMANCE_KEY, enabled ? 'reduced' : 'full'); } catch {}
}

setupRoots();
try { setTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'); setPerformanceMode(localStorage.getItem(PERFORMANCE_KEY) === 'reduced'); } catch { setTheme('dark'); setPerformanceMode(false); }
prefsButton?.addEventListener('click', () => { renderWindowSettings(); preferenceDialog.showModal(); });
renderWorkspacePresets();
preferenceDialog.querySelector('#save-workspace-layout').addEventListener('click', saveWorkspacePreset);
preferenceDialog.querySelector('#load-workspace-layout').addEventListener('click', loadWorkspacePreset);
preferenceDialog.querySelector('#delete-workspace-layout').addEventListener('click', deleteWorkspacePreset);
preferenceDialog.querySelector('#workspace-layout-select').addEventListener('change', () => renderWorkspacePresets(preferenceDialog.querySelector('#workspace-layout-select').value));
preferenceDialog.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
preferenceDialog.querySelector('#performance-mode').addEventListener('change', (event) => setPerformanceMode(event.target.checked));
preferenceDialog.querySelector('.restore-all').addEventListener('click', restoreWindows);
preferenceDialog.querySelector('.reset-layout').addEventListener('click', () => {
  for (const root of roots) {
    const byId = new Map([...root.querySelectorAll(':scope > .workspace-window')].map((node) => [node.dataset.windowId, node]));
    for (const id of defaultOrders.get(root.dataset.workspaceGrid) || []) if (byId.has(id)) root.append(byId.get(id));
    for (const node of byId.values()) {
      node.classList.toggle('is-hidden-window', (defaultHidden.get(root.dataset.workspaceGrid) || []).includes(node.dataset.windowId));
      node.classList.remove('is-minimized-window');
      updateMinimizeControl(node, false);
      node.classList.remove('is-resized-window'); node.removeAttribute('data-window-columns'); node.removeAttribute('data-window-height');
      node.style.removeProperty('--window-columns'); node.style.removeProperty('--window-height');
      clearFreePosition(node);
    }
  }
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(THEME_KEY); localStorage.removeItem(PERFORMANCE_KEY); } catch {}
  setTheme('dark'); setPerformanceMode(false); saveWorkspace(); renderWindowSettings();
});
contextMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'hide' && activeMenuWindow) hideWindow(activeMenuWindow);
  if (action === 'restore') restoreWindows();
});
document.addEventListener('pointerdown', (event) => { if (!contextMenu.contains(event.target)) contextMenu.classList.add('hidden'); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') contextMenu.classList.add('hidden'); });
window.addEventListener('blur', cancelWorkspaceGesture);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelWorkspaceGesture(); });

function openWorkspaceWindow(id) {
  const card = document.querySelector(`.workspace-window[data-window-id="${CSS.escape(id)}"]`);
  if (!card) return;
  card.classList.remove('is-hidden-window', 'is-minimized-window');
  const root = card.closest('[data-workspace-grid]');
  const step = root?.dataset.workspaceGrid;
  if (step) document.querySelector(`[data-step="${CSS.escape(step)}"]`)?.click();
  addWindowDialog.close(); saveWorkspace();
  requestAnimationFrame(() => { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('workspace-window-opened'); setTimeout(() => card.classList.remove('workspace-window-opened'), 900); });
}
addWindowButton.addEventListener('click', () => addWindowDialog.showModal());
addWindowDialog.querySelector('.square-icon').addEventListener('click', (event) => { event.preventDefault(); addWindowDialog.close(); });
addWindowDialog.querySelectorAll('[data-add-window]').forEach((button) => button.addEventListener('click', () => openWorkspaceWindow(button.dataset.addWindow)));
