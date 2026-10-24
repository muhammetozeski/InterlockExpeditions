/** WCAG relative luminance; alpha composition is evaluated before text contrast. */
export function luminance(color) { const channels = color.slice(0, 3).map(value => { const component = value / 255; return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4; }); return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722; }
export function contrast(left, right) { const a = luminance(left), b = luminance(right); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
export function composite(foreground, background) { const alpha = foreground[3] ?? 1; return [0, 1, 2].map(index => foreground[index] * alpha + background[index] * (1 - alpha)).concat(1); }
export function parseColor(value) {
  if (value === 'transparent') return [0, 0, 0, 0];
  const match = /^rgba?\(([^)]+)\)$/.exec(value.trim()); if (!match) return null;
  const parts = match[1].split(/[\s,\/]+/).filter(Boolean); if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map(part => parseFloat(part) * (part.endsWith('%') ? 2.55 : 1));
  const alpha = parts[3] === undefined ? 1 : parseFloat(parts[3]) * (parts[3].endsWith('%') ? 0.01 : 1);
  return channels.every(Number.isFinite) && Number.isFinite(alpha) ? channels.concat(alpha) : null;
}
function backgroundOf(element) { const ancestors = []; for (let item = element; item; item = item.parentElement) ancestors.push(item); let background = [255, 255, 255, 1]; for (const item of ancestors.reverse()) { const color = parseColor(getComputedStyle(item).backgroundColor); if (color) background = composite(color, background); } return background; }
/** Computes every visible direct text/control color again after Blazor inserts or changes content. */
export function correctTextContrast() {
  if (typeof document === 'undefined' || !document.body) return 0;
  let changed = 0;
  for (const element of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'PATH', 'CIRCLE', 'LINE', 'RECT'].includes(element.tagName.toUpperCase()) || !element.getClientRects().length) continue;
    const text = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION'].includes(element.tagName) || [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    if (!text) continue;
    const style = getComputedStyle(element), foreground = parseColor(style.color), background = backgroundOf(element); if (!foreground) continue;
    const shown = composite(foreground, background);
    if (contrast(shown, background) < 4.5) { const white = [255, 255, 255, 1], black = [0, 0, 0, 1], color = contrast(white, background) >= contrast(black, background) ? '#ffffff' : '#000000'; if (element.style.color !== color) { element.style.color = color; changed++; } }
    if (element.matches('input,textarea')) { const placeholder = parseColor(getComputedStyle(element, '::placeholder').color); if (placeholder && contrast(composite(placeholder, background), background) < 4.5) element.style.setProperty('--readable-placeholder', contrast([255, 255, 255], background) >= contrast([0, 0, 0], background) ? '#ffffff' : '#000000'); }
  }
  return changed;
}
if (typeof document !== 'undefined') {
  let scheduled = false;
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; correctTextContrast(); }); } };
  const install = () => { schedule(); new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'disabled', 'open', 'hidden'] }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
  window.interlockContrast = { check: correctTextContrast, contrast };
}
