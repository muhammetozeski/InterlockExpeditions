import assert from 'node:assert/strict';
import { contrast, luminance, parseColor, composite, correctTextContrast } from '../src/InterlockExpeditions.Portal/wwwroot/assets/contrast.js';
let checks = 0; const check = (value, label) => { assert.ok(value, label); checks++; };
check(luminance([0, 0, 0]) === 0 && luminance([255, 255, 255]) === 1, 'Relative luminance endpoints');
check(contrast([0, 0, 0], [255, 255, 255]) === 21, 'Black/white reference ratio');
check(Math.abs(contrast([119, 119, 119], [255, 255, 255]) - 4.478089453577214) < 0.000001, 'Known near-threshold contrast calculation');
check(parseColor('rgb(100% 0% 0% / 50%)').every((value, index) => Math.abs(value - [255, 0, 0, .5][index]) < .000001), 'Percentage/alpha browser color parsing');
check(composite([255, 0, 0, .5], [0, 0, 255, 1]).slice(0, 3).every((value, index) => value === [127.5, 0, 127.5][index]), 'Transparent foreground composition');
function element(color, backgroundColor, parentElement = null, tagName = 'P') { const properties = {}; return { tagName, parentElement, childNodes: [{ nodeType: 3, textContent: 'Readable authored text' }], baseColor: color, backgroundColor, style: { setProperty(key, value) { properties[key] = value; } }, properties, getClientRects() { return [1]; }, matches(selector) { return tagName === 'INPUT'; } }; }
function computed(element, pseudo) { const value = pseudo ? element.properties['--readable-placeholder'] ?? 'rgb(20, 20, 20)' : element.style.color ?? element.baseColor; const color = value === '#ffffff' ? 'rgb(255,255,255)' : value === '#000000' ? 'rgb(0,0,0)' : value; return { color, backgroundColor: element.backgroundColor }; }
const root = element('rgb(255,255,255)', 'rgb(16,16,15)'), invisible = element('rgb(0,0,0)', 'rgb(0,0,0)', root), black = element('rgb(0,0,0)', 'rgb(0,0,0)', root), white = element('rgb(250,250,250)', 'rgb(255,255,255)', root), readable = element('rgb(244,243,233)', 'transparent', root), input = element('rgb(255,255,255)', 'rgb(20,20,20)', root, 'INPUT'); invisible.getClientRects = () => [];
const previousDocument = globalThis.document, previousComputed = globalThis.getComputedStyle;
try {
  globalThis.document = { body: { querySelectorAll() { return [root, invisible, black, white, readable, input]; } } }; globalThis.getComputedStyle = computed;
  check(correctTextContrast() === 2, 'Actual correction function fixes exactly two unreadable text samples');
  check(black.style.color === '#ffffff' && white.style.color === '#000000', 'Correction selects the brighter valid contrast on each background');
  check(!readable.style.color && !invisible.style.color, 'Readable and invisible samples stay intact');
  check(input.properties['--readable-placeholder'] === '#ffffff', 'Unreadable control placeholder is corrected');
  check(correctTextContrast() === 0, 'Second scan is stable after correction');
} finally { globalThis.document = previousDocument; globalThis.getComputedStyle = previousComputed; }
console.log(`PASS ${checks} contrast math and actual correction-function checks against a minimal DOM fixture; this is not a native browser rendering claim.`);
