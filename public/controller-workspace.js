import { TORCH_EFFECTS } from './safety.js';

const STORAGE_KEY = 'crowdsync.controller.workspace.v2';
const THEME_KEY = 'crowdsync.controller.theme.v1';
const PERFORMANCE_KEY = 'crowdsync.controller.performance.v1';
const COMMUNITY_KEY = 'crowdsync.community-look-packs.v1';
const ICONS = {
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>',
};
const roots = [...document.querySelectorAll('[data-workspace-grid]')];
const prefsButton = document.querySelector('#controller-preferences');
const preferenceDialog = document.createElement('dialog');
preferenceDialog.className = 'controller-preferences-dialog';
preferenceDialog.setAttribute('aria-labelledby', 'controller-preferences-title');
preferenceDialog.innerHTML = '<form method="dialog"><header><div><div class="eyebrow">PRODUCTION DESK</div><h2 id="controller-preferences-title">Workspace preferences</h2></div><button class="square-icon" value="close" aria-label="Close preferences"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg></button></header><p class="preferences-copy">Arrange the control desk for this device. Window layouts and appearance are saved locally.</p><section class="preference-section"><h3>Theme</h3><div class="preference-choice-row"><button type="button" data-theme-choice="dark">Dark</button><button type="button" data-theme-choice="light">Light</button></div></section><section class="preference-section"><label class="preference-switch"><span><strong>Performance mode</strong><small>Reduce background movement and interface transitions.</small></span><input id="performance-mode" type="checkbox"><i aria-hidden="true"></i></label></section><section class="preference-section"><h3>Workspace windows</h3><div class="workspace-window-list"></div><button class="button button-secondary restore-all" type="button">Restore all windows</button><button class="button button-quiet reset-layout" type="button">Reset layout and preferences</button></section></form>';
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
addWindowDialog.innerHTML = '<header><div><div class="eyebrow">WORKSPACE</div><h2 id="add-window-title">Add a window</h2></div><button class="square-icon" value="close" formmethod="dialog" aria-label="Close window picker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg></button></header><p>Open a panel in its workspace. Drag it to snap, resize from its lower corner, or hide it with right-click.</p><div class="add-window-options"><button type="button" data-add-window="sync-check"><strong>Sync check</strong><small>Manage the audience timing test.</small></button><button type="button" data-add-window="join-code"><strong>Room code &amp; QR</strong><small>Share the room with guests.</small></button><button type="button" data-add-window="effect-library"><strong>Effects library</strong><small>Choose and preview built-in looks.</small></button><button type="button" data-add-window="community-effects"><strong>Community look packs</strong><small>Import a safety-bounded JSON pack locally.</small></button><button type="button" data-add-window="cue-sheet"><strong>Songs &amp; beat cues</strong><small>Upload local audio and edit detected beats.</small></button><button type="button" data-add-window="crowd-preview"><strong>Audience preview</strong><small>Preview the selected show output.</small></button><button type="button" data-add-window="show-controls"><strong>Live controls</strong><small>Transport, output and audience messaging.</small></button><button type="button" data-add-window="show-activity"><strong>Show activity</strong><small>Recent room events and connection status.</small></button></div><small class="add-window-footnote">Look packs stay on this browser. CrowdSync does not host a community upload service.</small>';
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
function saveWorkspace() {
  workspaceState = Object.fromEntries(roots.map((root) => [root.dataset.workspaceGrid, {
    order: [...root.querySelectorAll(':scope > .workspace-window')].map((node) => node.dataset.windowId),
    hidden: [...root.querySelectorAll(':scope > .workspace-window.is-hidden-window')].map((node) => node.dataset.windowId),
    sizes: Object.fromEntries([...root.querySelectorAll(':scope > .workspace-window[data-window-columns], :scope > .workspace-window[data-window-height]')].map((node) => [node.dataset.windowId, {
      columns: Number(node.dataset.windowColumns) || null, height: Number(node.dataset.windowHeight) || null,
    }])),
  }]));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaceState)); } catch {}
  renderWindowSettings();
}
function labelFor(card) {
  const labels = [
    ['audience-setup-card', 'AUDIENCE SYNC'], ['join-card', 'JOIN CODE'],
    ['crowd-preview-card', 'CROWD MONITOR'], ['effects-card', 'LIGHT DESIGN'],
    ['cue-builder-card', 'BEAT SEQUENCER'], ['community-effects-card', 'LOCAL LOOK PACKS'],
    ['live-controls-card', 'LIVE CONSOLE'], ['activity-card', 'ROOM ACTIVITY'],
  ];
  return labels.find(([className]) => card.classList.contains(className))?.[1]
    || card.querySelector('h2,h3')?.textContent?.trim() || 'Workspace window';
}
function addWindowBar(card) {
  const label = labelFor(card);
  const bar = document.createElement('div');
  bar.className = 'workspace-windowbar';
  bar.innerHTML = `<button class="workspace-drag-handle" type="button" aria-label="Drag ${label}">${ICONS.grip}</button><span class="workspace-window-title"></span><button class="workspace-hide" type="button" aria-label="Hide ${label}" title="Hide window">${ICONS.close}</button>`;
  bar.querySelector('.workspace-window-title').textContent = label;
  bar.querySelector('.workspace-drag-handle').addEventListener('pointerdown', startDrag);
  bar.querySelector('.workspace-hide').addEventListener('click', () => hideWindow(card));
  card.prepend(bar);
  const resizeHandle = document.createElement('button');
  resizeHandle.className = 'workspace-resize-handle'; resizeHandle.type = 'button';
  resizeHandle.setAttribute('aria-label', `Resize ${label}`); resizeHandle.title = 'Drag to resize';
  resizeHandle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 15 15 5M9 15l6-6M13 15l2-2"/></svg>';
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
      if (card.dataset.workspaceReady) continue;
      const id = card.classList.contains('audience-setup-card') ? 'sync-check'
        : card.classList.contains('join-card') ? 'join-code'
          : card.classList.contains('crowd-preview-card') ? 'crowd-preview'
            : card.classList.contains('effects-card') ? 'effect-library'
              : card.classList.contains('cue-builder-card') ? 'cue-sheet'
              : card.classList.contains('community-effects-card') ? 'community-effects'
                : card.classList.contains('live-controls-card') ? 'show-controls'
                  : card.classList.contains('activity-card') ? 'show-activity' : `window-${children.indexOf(card)}`;
      card.dataset.windowId = id;
      card.dataset.workspaceReady = 'true';
      addWindowBar(card);
      if (root.dataset.workspaceGrid === 'show' && card.parentElement !== root) root.append(card);
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
    for (const [id, size] of Object.entries(saved?.sizes || {})) {
      const card = root.querySelector(`:scope > [data-window-id="${CSS.escape(id)}"]`);
      if (!card) continue;
      if (Number.isInteger(size.columns) && size.columns >= 2 && size.columns <= 12) setWindowColumns(card, size.columns);
      if (Number.isInteger(size.height) && size.height >= 180 && size.height <= 1000) setWindowHeight(card, size.height);
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
  if (card.classList.contains('cue-builder-card') || card.classList.contains('community-effects-card')) return 12;
  if (card.classList.contains('audience-setup-card') || card.classList.contains('live-controls-card')) return 8;
  if (card.classList.contains('join-card') || card.classList.contains('activity-card')) return 4;
  if (card.classList.contains('crowd-preview-card')) return 7;
  if (card.classList.contains('effects-card')) return 5;
  return 6;
}
function setWindowColumns(card, columns) {
  card.dataset.windowColumns = String(columns);
  card.style.setProperty('--window-columns', String(columns));
}
function setWindowHeight(card, height) {
  card.dataset.windowHeight = String(height);
  card.style.setProperty('--window-height', `${height}px`);
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
  if (event.button !== 0 || !event.isPrimary || resizeState || draggedWindow) return;
  const card = event.currentTarget.closest('.workspace-window');
  if (!card) return;
  event.preventDefault(); movingWindow = card;
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
  resizeState = { card, root, id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, columns, columnWidth: (root.clientWidth - gap * 11) / 12 + gap };
  card.classList.add('is-resizing-window'); event.currentTarget.setPointerCapture(event.pointerId);
  document.addEventListener('pointermove', resizeMove);
  document.addEventListener('pointerup', endResize, { once: true });
  document.addEventListener('pointercancel', endResize, { once: true });
}
function resizeMove(event) {
  if (!resizeState || event.pointerId !== resizeState.id) return;
  const { card, root, x, y, width, height, columns, columnWidth } = resizeState;
  if (innerWidth > 860) setWindowColumns(card, Math.max(2, Math.min(12, columns + Math.round((event.clientX - x) / Math.max(1, columnWidth)))));
  setWindowHeight(card, Math.max(190, Math.min(1000, Math.round(height + event.clientY - y))));
  root.classList.add('is-resizing');
}
function endResize() {
  document.removeEventListener('pointermove', resizeMove);
  document.removeEventListener('pointerup', endResize); document.removeEventListener('pointercancel', endResize);
  if (resizeState) { resizeState.card.classList.remove('is-resizing-window'); resizeState.root.classList.remove('is-resizing'); saveWorkspace(); }
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
    document.body.append(draggedWindow);
    draggedWindow.classList.add('is-dragging-window');
    Object.assign(draggedWindow.style, { position: 'fixed', zIndex: '1000', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', pointerEvents: 'none', overflow: 'hidden' });
    root.classList.add('is-dragging'); animateReflow(root, before);
  }
  if (!draggedWindow) return;
  const root = dragSlot?.parentElement;
  if (!root) return;
  draggedWindow.style.left = `${event.clientX - pointerOrigin.grabX}px`;
  draggedWindow.style.top = `${event.clientY - pointerOrigin.grabY}px`;
  updateDragField({ currentTarget: root, clientX: event.clientX, clientY: event.clientY });
  const candidate = targetAtPoint(root, event.clientX, event.clientY);
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
function endDrag() {
  document.removeEventListener('pointermove', dragMove);
  document.removeEventListener('pointerup', endDrag); document.removeEventListener('pointercancel', endDrag);
  if (draggedWindow) {
    const root = dragSlot?.parentElement, before = root ? captureLayout(root) : new Map();
    snapTarget?.classList.remove('workspace-snap-preview'); snapTarget = null;
    for (const prop of ['position','zIndex','left','top','width','height','margin','pointerEvents','overflow']) draggedWindow.style.removeProperty(prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
    draggedWindow.classList.remove('is-dragging-window');
    if (dragSlot?.parentElement) dragSlot.replaceWith(draggedWindow);
    const droppedWindow = draggedWindow; droppedWindow.classList.add('is-dropping-window'); setTimeout(() => droppedWindow.classList.remove('is-dropping-window'), 280);
    root?.classList.remove('is-dragging');
    if (root) animateReflow(root, before);
    saveWorkspace();
  }
  draggedWindow = null; movingWindow = null; pointerOrigin = null; dragSlot = null;
}
function cancelWorkspaceGesture() {
  if (movingWindow || draggedWindow) endDrag();
  if (resizeState) endResize();
}
function hideWindow(card) {
  card.classList.add('is-hidden-window'); contextMenu.classList.add('hidden'); saveWorkspace();
}
function restoreWindows() {
  document.querySelectorAll('.is-hidden-window').forEach((node) => node.classList.remove('is-hidden-window'));
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
preferenceDialog.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
preferenceDialog.querySelector('#performance-mode').addEventListener('change', (event) => setPerformanceMode(event.target.checked));
preferenceDialog.querySelector('.restore-all').addEventListener('click', restoreWindows);
preferenceDialog.querySelector('.reset-layout').addEventListener('click', () => {
  for (const root of roots) {
    const byId = new Map([...root.querySelectorAll(':scope > .workspace-window')].map((node) => [node.dataset.windowId, node]));
    for (const id of defaultOrders.get(root.dataset.workspaceGrid) || []) if (byId.has(id)) root.append(byId.get(id));
    for (const node of byId.values()) {
      node.classList.toggle('is-hidden-window', (defaultHidden.get(root.dataset.workspaceGrid) || []).includes(node.dataset.windowId));
      node.classList.remove('is-resized-window'); node.removeAttribute('data-window-columns'); node.removeAttribute('data-window-height');
      node.style.removeProperty('--window-columns'); node.style.removeProperty('--window-height');
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
  card.classList.remove('is-hidden-window');
  const root = card.closest('[data-workspace-grid]');
  const step = root?.dataset.workspaceGrid;
  if (step) document.querySelector(`[data-step="${CSS.escape(step)}"]`)?.click();
  addWindowDialog.close(); saveWorkspace();
  requestAnimationFrame(() => { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('workspace-window-opened'); setTimeout(() => card.classList.remove('workspace-window-opened'), 900); });
}
addWindowButton.addEventListener('click', () => addWindowDialog.showModal());
addWindowDialog.querySelector('.square-icon').addEventListener('click', (event) => { event.preventDefault(); addWindowDialog.close(); });
addWindowDialog.querySelectorAll('[data-add-window]').forEach((button) => button.addEventListener('click', () => openWorkspaceWindow(button.dataset.addWindow)));

function loadCommunityPacks() {
  try {
    const packs = JSON.parse(localStorage.getItem(COMMUNITY_KEY) || '[]');
    if (!Array.isArray(packs)) return [];
    return packs.slice(0, 40).flatMap((pack) => {
      if (!pack || typeof pack.id !== 'string' || typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 48 || !Array.isArray(pack.looks)) return [];
      const looks = pack.looks.slice(0, 24).filter((look) => look && typeof look.name === 'string' && !!look.name.trim() && look.name.length <= 40 && Object.hasOwn(TORCH_EFFECTS, look.effect) && /^#[\da-f]{6}$/i.test(look.screenColor) && /^#[\da-f]{6}$/i.test(look.accentColor)).map((look) => ({ name: look.name.trim(), effect: look.effect, screenColor: look.screenColor.toLowerCase(), accentColor: look.accentColor.toLowerCase() }));
      return looks.length ? [{ id: pack.id, name: pack.name.trim(), looks }] : [];
    });
  } catch { return []; }
}
let communityPacks = loadCommunityPacks();
function persistCommunityPacks() {
  try { localStorage.setItem(COMMUNITY_KEY, JSON.stringify(communityPacks.slice(0, 40))); }
  catch { window.dispatchEvent(new CustomEvent('crowdsync:toast', { detail: 'Storage is full. Remove a look pack and try again.' })); }
  renderCommunityPacks();
}
function downloadLookPack(pack, filename) {
  const payload = { version: 1, name: pack.name, looks: pack.looks };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderCommunityPacks() {
  const list = document.querySelector('#community-effects-list'); if (!list) return;
  list.replaceChildren();
  if (!communityPacks.length) { const empty = document.createElement('p'); empty.className = 'small-copy'; empty.textContent = 'No packs imported yet.'; list.append(empty); return; }
  for (const pack of communityPacks) {
    const section = document.createElement('section'); section.className = 'community-pack';
    const heading = document.createElement('div'); heading.className = 'community-pack-heading';
    const name = document.createElement('strong'); name.textContent = pack.name;
    const exportPack = document.createElement('button'); exportPack.type = 'button'; exportPack.className = 'button button-quiet'; exportPack.textContent = 'Export';
    exportPack.addEventListener('click', () => downloadLookPack(pack, `${pack.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'crowdsync-pack'}.json`));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-quiet'; remove.textContent = 'Remove pack';
    remove.addEventListener('click', () => { communityPacks = communityPacks.filter((entry) => entry.id !== pack.id); persistCommunityPacks(); });
    heading.append(name, exportPack, remove); section.append(heading);
    for (const look of pack.looks) {
      const use = document.createElement('button'); use.type = 'button'; use.className = 'community-look';
      const colors = document.createElement('span'); colors.className = 'community-look-colors';
      for (const color of [look.screenColor, look.accentColor]) { const swatch = document.createElement('i'); swatch.style.backgroundColor = color; colors.append(swatch); }
      const label = document.createElement('span'); label.textContent = `${look.name} · ${TORCH_EFFECTS[look.effect]?.label || look.effect}`;
      use.append(colors, label); use.addEventListener('click', () => window.dispatchEvent(new CustomEvent('crowdsync:use-look', { detail: look })));
      section.append(use);
    }
    list.append(section);
  }
}
document.querySelector('#community-pack-file')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  if (file.size > 32_000) { window.dispatchEvent(new CustomEvent('crowdsync:toast', { detail: 'Look packs must be 32 KB or smaller.' })); return; }
  try {
    const pack = JSON.parse(await file.text());
    if (pack?.version !== 1 || typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 48 || !Array.isArray(pack.looks) || !pack.looks.length || pack.looks.length > 24) throw new Error('Use a version 1 look pack with 1–24 looks.');
    const looks = pack.looks.map((look) => {
      if (!look || typeof look.name !== 'string' || !look.name.trim() || look.name.length > 40 || !Object.hasOwn(TORCH_EFFECTS, look.effect) || !/^#[\da-f]{6}$/i.test(look.screenColor) || !/^#[\da-f]{6}$/i.test(look.accentColor)) throw new Error('Each look needs a short name, built-in effect, and two hex colors.');
      return { name: look.name.trim(), effect: look.effect, screenColor: look.screenColor.toLowerCase(), accentColor: look.accentColor.toLowerCase() };
    });
    communityPacks = [{ id: crypto.randomUUID(), name: pack.name.trim(), looks }, ...communityPacks].slice(0, 40);
    persistCommunityPacks(); window.dispatchEvent(new CustomEvent('crowdsync:toast', { detail: 'Look pack imported locally.' }));
  } catch (error) { window.dispatchEvent(new CustomEvent('crowdsync:toast', { detail: error instanceof SyntaxError ? 'That file is not valid JSON.' : error.message || 'The look pack could not be imported.' })); }
});
document.querySelector('#community-export-example')?.addEventListener('click', () => {
  const pack = { version: 1, name: 'CrowdSync example', looks: [{ name: 'Monochrome pulse', effect: 'pulse', screenColor: '#efeee9', accentColor: '#9d9b92' }] };
  downloadLookPack(pack, 'crowdsync-look-pack.example.json');
});
renderCommunityPacks();
