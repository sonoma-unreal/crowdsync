import { lucide } from './lucide.js';

const form = document.querySelector('#join-form');
const input = document.querySelector('#join-code');
const error = document.querySelector('#home-error');
const themeToggle = document.querySelector('#theme-toggle');
const logoButton = document.querySelector('#logo-glow');
const hero = document.querySelector('.home-hero');
const featurePoints = [...document.querySelectorAll('.hero-point')];
const themeKey = 'crowdsync.home.theme';
let focusGlowTarget = null;

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

function setGlowPosition(x, y) {
  const clampedX = Math.max(0, Math.min(100, x));
  const clampedY = Math.max(0, Math.min(100, y));
  const dx = clampedX - 50;
  const dy = clampedY - 50;
  const edge = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
  const edgeProgress = Math.max(20, Math.min(80, edge === 'top' || edge === 'bottom' ? clampedX : clampedY));
  logoButton.classList.remove('edge-top', 'edge-right', 'edge-bottom', 'edge-left');
  logoButton.classList.add(`edge-${edge}`);
  logoButton.style.setProperty('--edge-progress', `${edgeProgress}%`);
  logoButton.style.setProperty('--light-x', `${clampedX}%`);
  logoButton.style.setProperty('--light-y', `${clampedY}%`);
}

function showHoverGlow(x, y, target = null) {
  setGlowPosition(x, y);
  focusGlowTarget = target;
  logoButton.classList.add('is-hovering');
}

function resetGlowWhenUnlit() {
  if (focusGlowTarget && document.activeElement === focusGlowTarget) return;
  focusGlowTarget = null;
  logoButton.classList.remove('is-hovering');
  if (logoButton.getAttribute('aria-pressed') !== 'true') setGlowPosition(50, 50);
}

hero.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  if (event.target.closest('.hero-point')) return;
  const bounds = logoButton.querySelector('.emblem-logo').getBoundingClientRect();
  const padding = Math.max(64, bounds.width * 0.52);
  const insideLightField = event.clientX >= bounds.left - padding
    && event.clientX <= bounds.right + padding
    && event.clientY >= bounds.top - padding
    && event.clientY <= bounds.bottom + padding;
  if (!insideLightField) {
    resetGlowWhenUnlit();
    return;
  }
  showHoverGlow((event.clientX - bounds.left) / bounds.width * 100, (event.clientY - bounds.top) / bounds.height * 100);
});
hero.addEventListener('pointerleave', resetGlowWhenUnlit);
logoButton.addEventListener('focus', () => {
  if (!logoButton.matches(':hover')) showHoverGlow(50, 22, logoButton);
});

featurePoints.forEach((point) => {
  const focusGlow = () => showHoverGlow(Number(point.dataset.glowX), Number(point.dataset.glowY), point);
  point.addEventListener('pointerenter', focusGlow);
  point.addEventListener('focus', focusGlow);
  point.addEventListener('click', focusGlow);
  point.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch' && document.activeElement !== point) resetGlowWhenUnlit();
  });
  point.addEventListener('blur', resetGlowWhenUnlit);
});

logoButton.addEventListener('click', () => {
  const glowing = logoButton.getAttribute('aria-pressed') !== 'true';
  logoButton.setAttribute('aria-pressed', String(glowing));
  logoButton.setAttribute('aria-label', glowing ? 'Turn off colorful CrowdSync glow' : 'Turn on colorful CrowdSync glow');
  logoButton.classList.toggle('is-glowing', glowing);
});

input.addEventListener('input', () => {
  input.value = input.value.replace(/\D/g, '').slice(0, 6);
  error.textContent = '';
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = input.value.trim();
  if (!/^\d{6}$/.test(code)) { error.textContent = 'Enter all six digits.'; return; }
  location.href = `/join/${code}`;
});
