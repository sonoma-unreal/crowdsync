import { lucide } from './lucide.js';

const form = document.querySelector('#join-form');
const input = document.querySelector('#join-code');
const error = document.querySelector('#home-error');
const themeToggle = document.querySelector('#theme-toggle');
const logoButton = document.querySelector('#logo-glow');
const hero = document.querySelector('.home-hero');
const featurePoints = [...document.querySelectorAll('.hero-point')];
const themeKey = 'crowdsync.home.theme';

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
  logoButton.style.setProperty('--light-x', `${clampedX}%`);
  logoButton.style.setProperty('--light-y', `${clampedY}%`);
}

hero.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  if (event.target.closest('.hero-point')) return;
  const bounds = logoButton.getBoundingClientRect();
  const padding = Math.max(44, bounds.width * 0.42);
  const trackingWidth = bounds.width + padding * 2;
  const trackingHeight = bounds.height + padding * 2;
  setGlowPosition((event.clientX - bounds.left + padding) / trackingWidth * 100, (event.clientY - bounds.top + padding) / trackingHeight * 100);
});
hero.addEventListener('pointerleave', () => setGlowPosition(50, 50));

featurePoints.forEach((point) => {
  const focusGlow = () => setGlowPosition(Number(point.dataset.glowX), Number(point.dataset.glowY));
  point.addEventListener('pointerenter', focusGlow);
  point.addEventListener('focus', focusGlow);
  point.addEventListener('click', focusGlow);
  point.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch' && document.activeElement !== point) setGlowPosition(50, 50);
  });
  point.addEventListener('blur', () => setGlowPosition(50, 50));
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
