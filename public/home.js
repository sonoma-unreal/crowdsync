import { lucide } from './lucide.js';

const form = document.querySelector('#join-form');
const input = document.querySelector('#join-code');
const error = document.querySelector('#home-error');
const themeToggle = document.querySelector('#theme-toggle');
const themeKey = 'crowdsync.home.theme';

function setTheme(theme) {
  const light = theme === 'light';
  document.body.dataset.theme = light ? 'light' : 'dark';
  themeToggle.setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} theme`);
  themeToggle.querySelector('.theme-label').textContent = light ? 'LIGHT' : 'DARK';
  themeToggle.querySelector('.theme-glyph').innerHTML = lucide(light ? 'moon' : 'sun', 16);
  document.querySelector('meta[name="theme-color"]').content = light ? '#f4f3ef' : '#090909';
  try { localStorage.setItem(themeKey, light ? 'light' : 'dark'); } catch {}
}

let savedTheme = 'dark';
try { savedTheme = localStorage.getItem(themeKey) || 'dark'; } catch {}
setTheme(savedTheme);
themeToggle.addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));

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
