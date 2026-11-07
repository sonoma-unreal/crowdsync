const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hexToRgb = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
const rgbToHex = rgb => `#${rgb.map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsv([red, green, blue]) {
  const r = red / 255, g = green / 255, b = blue / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return { h: (hue + 360) % 360, s: max ? delta / max : 0, v: max };
}

function hsvToRgb({ h, s, v }) {
  const chroma = v * s, x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), m = v - chroma;
  const segment = Math.floor(h / 60) % 6, rgb = segment === 0 ? [chroma, x, 0] : segment === 1 ? [x, chroma, 0] : segment === 2 ? [0, chroma, x] : segment === 3 ? [0, x, chroma] : segment === 4 ? [x, 0, chroma] : [chroma, 0, x];
  return rgb.map(channel => (channel + m) * 255);
}

export function openCustomColorPicker(initialColor = '#ffffff') {
  const dialog = document.querySelector('#custom-color-dialog');
  const wheel = dialog?.querySelector('#custom-color-wheel');
  if (!dialog || !wheel) return Promise.resolve(null);
  if (dialog.open) return Promise.resolve(null);
  const inputs = ['red', 'green', 'blue'].map(channel => dialog.querySelector(`#custom-color-${channel}`));
  const range = dialog.querySelector('#custom-color-brightness-range');
  const output = dialog.querySelector('#custom-color-brightness-value');
  const marker = wheel.querySelector('span');
  const channels = hexToRgb(/^#[\da-f]{6}$/i.test(initialColor) ? initialColor : '#ffffff');
  const initialHsv = rgbToHsv(channels);
  let color = { h: initialHsv.h, s: initialHsv.s, brightness: 255 };
  let pointerId = null, settled = false, resolveResult;
  const promise = new Promise(resolve => { resolveResult = resolve; });

  const outputRgb = () => channels.map(channel => channel * color.brightness / 255);
  const render = () => {
    inputs.forEach((input, index) => { if (document.activeElement !== input) input.value = channels[index].toFixed(2); });
    range.value = String(Math.round(color.brightness));
    output.value = `${Math.round(color.brightness / 255 * 100)}%`;
    const radius = Math.max(0, wheel.clientWidth / 2 - 12), radians = color.h * Math.PI / 180;
    marker.style.left = `calc(50% + ${Math.cos(radians) * radius * color.s}px)`;
    marker.style.top = `calc(50% - ${Math.sin(radians) * radius * color.s}px)`;
    wheel.setAttribute('aria-valuenow', String(Math.round(color.h)));
    wheel.style.setProperty('--picker-color', rgbToHex(outputRgb()));
  };
  const settle = value => {
    if (settled) return;
    settled = true;
    if (dialog.open) dialog.close();
    resolveResult(value);
  };
  const colorFromInput = event => {
    const index = inputs.indexOf(event.currentTarget), value = Number.parseFloat(event.currentTarget.value);
    if (index < 0 || !Number.isFinite(value)) return;
    channels[index] = clamp(value, 0, 255);
    const hueSaturation = rgbToHsv(channels); color.h = hueSaturation.h; color.s = hueSaturation.s; render();
  };
  const selectWheelPoint = event => {
    const rect = wheel.getBoundingClientRect(), dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const radius = Math.max(1, rect.width / 2 - 12), distance = Math.min(1, Math.hypot(dx, dy) / radius);
    if (Math.hypot(dx, dy) > 1) color.h = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
    color.s = distance;
    channels.splice(0, channels.length, ...hsvToRgb({ h: color.h, s: color.s, v: 1 }));
    render();
  };

  inputs.forEach(input => { input.oninput = colorFromInput; input.onchange = colorFromInput; input.onblur = render; });
  range.oninput = () => { color.brightness = Number(range.value); render(); };
  wheel.onpointerdown = event => { if (event.button !== 0) return; pointerId = event.pointerId; wheel.setPointerCapture(pointerId); selectWheelPoint(event); };
  wheel.onpointermove = event => { if (pointerId === event.pointerId) selectWheelPoint(event); };
  const endPointer = event => { if (pointerId === event.pointerId) pointerId = null; };
  wheel.onpointerup = endPointer; wheel.onpointercancel = endPointer;
  wheel.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); color.h = (color.h + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? 358 : 2)) % 360; channels.splice(0, channels.length, ...hsvToRgb({ h: color.h, s: color.s, v: 1 })); render();
  };
  dialog.querySelector('#custom-color-reset').onclick = () => { channels.splice(0, channels.length, 255, 255, 255); color = { h: 0, s: 0, brightness: 255 }; render(); };
  dialog.querySelector('#custom-color-cancel').onclick = () => settle(null);
  dialog.querySelector('#custom-color-apply').onclick = () => settle(rgbToHex(outputRgb()));
  dialog.oncancel = event => { event.preventDefault(); settle(null); };
  dialog.onclick = event => { if (event.target === dialog) settle(null); };
  dialog.showModal(); render();
  return promise;
}
