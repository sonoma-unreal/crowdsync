const STORAGE_KEY = 'crowdsync.controller.workspace.v1';
const THEME_KEY = 'crowdsync.controller.theme.v1';
const PERFORMANCE_KEY = 'crowdsync.controller.performance.v1';
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

let draggedWindow = null;
let activeMenuWindow = null;
let pointerOrigin = null;
let movingWindow = null;
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
  }]));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaceState)); } catch {}
  renderWindowSettings();
}
function labelFor(card) {
  return card.querySelector('.section-title')?.textContent?.trim().replace(/\s+/g, ' ').split('  ')[0]
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
                : card.classList.contains('live-controls-card') ? 'show-controls'
                  : card.classList.contains('activity-card') ? 'show-activity' : `window-${children.indexOf(card)}`;
      card.dataset.windowId = id;
      card.dataset.workspaceReady = 'true';
      addWindowBar(card);
      if (root.dataset.workspaceGrid === 'show' && card.parentElement !== root) root.append(card);
      card.addEventListener('contextmenu', (event) => {
        event.preventDefault(); activeMenuWindow = card;
        contextMenu.style.left = `${Math.min(event.clientX, innerWidth - 190)}px`;
        contextMenu.style.top = `${Math.min(event.clientY, innerHeight - 94)}px`;
        contextMenu.classList.remove('hidden');
      });
    }
    root.classList.add('workspace-grid');
    const saved = workspaceState[root.dataset.workspaceGrid];
    if (saved?.order?.length) {
      const byId = new Map([...root.querySelectorAll(':scope > .workspace-window')].map((node) => [node.dataset.windowId, node]));
      for (const id of saved.order) if (byId.has(id)) root.append(byId.get(id));
    }
    for (const id of saved?.hidden || []) root.querySelector(`:scope > [data-window-id="${CSS.escape(id)}"]`)?.classList.add('is-hidden-window');
  }
  saveWorkspace();
}
function updateDragField(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--pointer-x', `${event.clientX - bounds.left}px`);
  event.currentTarget.style.setProperty('--pointer-y', `${event.clientY - bounds.top}px`);
}
function startDrag(event) {
  if (event.button !== 0 || !event.isPrimary) return;
  const card = event.currentTarget.closest('.workspace-window');
  if (!card) return;
  event.preventDefault(); movingWindow = card; pointerOrigin = { x: event.clientX, y: event.clientY, id: event.pointerId };
  event.currentTarget.setPointerCapture(event.pointerId);
  document.addEventListener('pointermove', dragMove);
  document.addEventListener('pointerup', endDrag, { once: true });
  document.addEventListener('pointercancel', endDrag, { once: true });
}
function dragMove(event) {
  if (!movingWindow || !pointerOrigin || event.pointerId !== pointerOrigin.id) return;
  if (!draggedWindow && Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y) > 7) {
    draggedWindow = movingWindow; draggedWindow.classList.add('is-dragging-window');
    draggedWindow.closest('.workspace-grid')?.classList.add('is-dragging');
  }
  if (!draggedWindow) return;
  const root = draggedWindow.parentElement;
  updateDragField({ currentTarget: root, clientX: event.clientX, clientY: event.clientY });
  const candidates = [...root.querySelectorAll(':scope > .workspace-window:not(.is-hidden-window):not(.is-dragging-window)')];
  const before = candidates.find((candidate) => {
    const box = candidate.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 || (Math.abs(event.clientY - box.top - box.height / 2) < box.height / 4 && event.clientX < box.left + box.width / 2);
  });
  if (before) root.insertBefore(draggedWindow, before);
  else root.append(draggedWindow);
}
function endDrag() {
  document.removeEventListener('pointermove', dragMove);
  if (draggedWindow) {
    const root = draggedWindow.closest('.workspace-grid');
    draggedWindow.classList.remove('is-dragging-window'); root?.classList.remove('is-dragging');
    saveWorkspace();
  }
  draggedWindow = null; movingWindow = null; pointerOrigin = null;
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
  for (const root of roots) [...root.querySelectorAll(':scope > .workspace-window')].forEach((node) => root.append(node));
  document.querySelectorAll('.is-hidden-window').forEach((node) => node.classList.remove('is-hidden-window'));
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
