const gate = document.querySelector('#immersive-gate');
const enterButton = document.querySelector('#immersive-enter');
const supportNote = document.querySelector('#immersive-support-note');
const fullscreenToggle = document.querySelector('#immersive-toggle');
const themeButtons = [document.querySelector('#audience-theme-dark'), document.querySelector('#audience-theme-light')];
const THEME_KEY = 'crowdsync.audience.theme.v1';
let controlsTimer = 0;
let needsImmersion = false;

window.crowdImmersionActive = false;
window.crowdEffectsVisible = true;

function setTheme(theme) {
  document.body.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  themeButtons.forEach((button, index) => button?.setAttribute('aria-pressed', String((index === 0 ? 'dark' : 'light') === theme)));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f2f1ec' : '#090909';
}
try { setTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'); } catch { setTheme('dark'); }
themeButtons[0]?.addEventListener('click', () => setTheme('dark'));
themeButtons[1]?.addEventListener('click', () => setTheme('light'));
if (!document.documentElement.requestFullscreen) {
  enterButton.textContent = 'Use immersive view';
  supportNote.textContent = 'This browser does not support full screen. The app will fill the visible screen area and hide its controls after five seconds.';
}

function isFullscreen() {
  return !!document.fullscreenElement || document.body.classList.contains('immersive-pseudo')
    || navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}
function notifyImmersion() {
  window.crowdImmersionActive = isFullscreen();
  document.body.classList.toggle('immersive-active', window.crowdImmersionActive);
  const showState = document.querySelector('#show-state')?.textContent?.trim().toLowerCase() || '';
  const joined = showState.startsWith('synced') || showState === 'show is live' || showState === 'show paused' || showState === 'blackout active';
  fullscreenToggle?.classList.toggle('hidden', !joined);
  if (fullscreenToggle) { const active = !!document.fullscreenElement || document.body.classList.contains('immersive-pseudo'); fullscreenToggle.textContent = active ? 'Exit full screen' : 'Full screen'; fullscreenToggle.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen'); }
  if (window.crowdImmersionActive) {
    gate.classList.add('hidden');
    revealControls();
  } else {
    window.crowdEffectsVisible = false;
    document.body.classList.remove('audience-ui-visible');
    if (needsImmersion) gate.classList.remove('hidden');
  }
  window.dispatchEvent(new CustomEvent('crowdsync:immersion', { detail: { active: window.crowdImmersionActive } }));
}
function revealControls() {
  if (!window.crowdImmersionActive) return;
  clearTimeout(controlsTimer);
  document.body.classList.add('audience-ui-visible');
  window.crowdEffectsVisible = false;
  window.dispatchEvent(new CustomEvent('crowdsync:immersion', { detail: { active: true, effectsVisible: false } }));
  controlsTimer = setTimeout(() => {
    document.body.classList.remove('audience-ui-visible');
    window.crowdEffectsVisible = true;
    window.dispatchEvent(new CustomEvent('crowdsync:immersion', { detail: { active: true, effectsVisible: true } }));
  }, 5000);
}
function updateGate() {
  const state = document.querySelector('#show-state')?.textContent?.trim().toLowerCase() || '';
  needsImmersion = state === 'show is live';
  if (!needsImmersion) {
    gate.classList.add('hidden');
    return;
  }
  if (isFullscreen()) notifyImmersion();
  else {
    window.crowdImmersionActive = false;
    document.body.classList.remove('immersive-active');
    gate.classList.remove('hidden');
  }
}
async function enterImmersive() {
  if (document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      notifyImmersion();
      return;
    } catch {
      supportNote.textContent = 'Fullscreen was blocked. Tap again from the page, or allow full screen in your browser.';
      return;
    }
  }
  document.body.classList.add('immersive-pseudo');
  supportNote.textContent = 'This browser does not expose full screen mode. Immersive view is active; use your browser’s Add to Home Screen option for a cleaner display.';
  notifyImmersion();
}

enterButton.addEventListener('click', () => { void enterImmersive(); });
async function exitImmersive() {
  if (document.body.classList.contains('immersive-pseudo')) document.body.classList.remove('immersive-pseudo');
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  notifyImmersion();
}
fullscreenToggle?.addEventListener('click', () => {
  if (document.fullscreenElement || document.body.classList.contains('immersive-pseudo')) void exitImmersive();
  else void enterImmersive();
});
document.addEventListener('fullscreenchange', () => { notifyImmersion(); updateGate(); });
document.addEventListener('pointerdown', (event) => {
  if (!window.crowdImmersionActive || gate.contains(event.target)) return;
  revealControls();
});
document.addEventListener('keydown', () => { if (window.crowdImmersionActive) revealControls(); });
document.addEventListener('touchstart', () => { if (window.crowdImmersionActive) revealControls(); }, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) { window.crowdEffectsVisible = false; window.dispatchEvent(new CustomEvent('crowdsync:immersion', { detail: { active: window.crowdImmersionActive, effectsVisible: false } })); } else if (window.crowdImmersionActive) revealControls(); });
new MutationObserver(() => { updateGate(); notifyImmersion(); }).observe(document.querySelector('#show-state'), { childList: true, characterData: true, subtree: true });
updateGate();
