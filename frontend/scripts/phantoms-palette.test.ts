import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const rootBlock = css.match(/:root\s*\{([^}]+)\}/)?.[1];
const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1];
assert.ok(rootBlock, 'light :root token block exists');
assert.ok(darkBlock, 'dark theme token block exists');

function declarations(block: string) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}
const light = declarations(rootBlock);
const dark = declarations(darkBlock);

function color(name: string, theme: Record<string, string> = light): string {
  let value = theme[name] ?? light[name];
  if (!value) throw new Error(`Missing CSS token --${name}`);
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return color(alias[1], theme);
  if (value === '#fff') return '#ffffff';
  if (/^#[\da-f]{3}$/i.test(value)) value = `#${value.substring(1).split('').map((part) => part + part).join('')}`;
  assert.match(value, /^#[\da-f]{6}$/i, `--${name} must resolve to a six-digit hex color`);
  return value.toLowerCase();
}

function channels(hex: string) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex: string) {
  const linear = channels(hex).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground: string, background: string) {
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

function hue(hex: string) {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let degrees = 0;
  if (delta !== 0) {
    if (max === r) degrees = 60 * (((g - b) / delta) % 6);
    else if (max === g) degrees = 60 * ((b - r) / delta + 2);
    else degrees = 60 * ((r - g) / delta + 4);
  }
  return (degrees + 360) % 360;
}

function hueDistance(first: number, second: number) {
  const delta = Math.abs(first - second) % 360;
  return Math.min(delta, 360 - delta);
}

function assertFamily(theme: Record<string, string>, tokenNames: string[], reference: string, tolerance: number) {
  const referenceHue = hue(color(reference, theme));
  for (const token of tokenNames) {
    const valueHue = hue(color(token, theme));
    assert.ok(hueDistance(valueHue, referenceHue) <= tolerance,
      `--${token} hue ${valueHue.toFixed(1)}° should stay in the ${reference} family (${referenceHue.toFixed(1)}° ± ${tolerance}°)`);
  }
}

test('canonical identity roots and theme anchors use the required Crimson, Emerald, and Prussian Blue hexes', () => {
  assert.equal(color('crimson'), '#dc143c');
  assert.equal(color('emerald'), '#10b981');
  assert.equal(color('prussian-blue'), '#00072d');
  assert.equal(color('bg', dark), '#00072d');
  assert.equal(color('primary'), '#dc143c');
  assert.equal(color('success'), '#10b981');
});

test('semantic reds, greens, and blue accents stay in the requested color families in both themes', () => {
  const crimson = ['primary', 'primary-hover', 'primary-active', 'primary-soft', 'primary-ink', 'danger', 'danger-hover', 'danger-soft', 'danger-border', 'danger-text', 'accent-pink', 'accent-pink-soft'];
  const emerald = ['success', 'success-hover', 'success-soft', 'success-border', 'success-text', 'heat-1', 'heat-2', 'heat-3', 'heat-4'];
  const prussian = ['link', 'link-hover', 'accent', 'chart-blue', 'chart-ice', 'chart-cyan', 'chart-slate', 'info', 'info-hover', 'info-soft', 'info-border', 'info-text', 'border-focus', 'focus-ring', 'sidebar-hover', 'sidebar-border'];
  const prussianActive = ['sidebar-active-bg', 'sidebar-active-ink', 'sidebar-active-border'];
  for (const theme of [light, dark]) {
    assertFamily(theme, crimson, 'crimson', 18);
    assertFamily(theme, emerald, 'emerald', 16);
    assertFamily(theme, prussian, 'prussian-blue', 9);
    assertFamily(theme, prussianActive, 'prussian-blue', 12);
    assertFamily(theme, ['sidebar-muted'], 'prussian-blue', 14);
    assertFamily(theme, ['sidebar-logout-color'], 'crimson', 18);
  }
});

test('dark surfaces remain in the Prussian navy family and heatmap endpoints map to the background and Emerald', () => {
  const surfaces = ['bg', 'surface', 'surface-2', 'surface-hover', 'bg-elevated', 'surface-elevated', 'card', 'card-hover'];
  for (const token of surfaces) {
    assert.ok(hueDistance(hue(color(token, dark)), hue(color('prussian-blue'))) <= 12,
      `dark --${token} should remain a navy derived from Prussian Blue`);
  }
  for (const theme of [light, dark]) {
    assert.equal(color('heat-0', theme), color('bg', theme), 'heatmap level zero is the theme background');
    assert.equal(color('heat-4', theme), color('emerald'), 'heatmap level four is canonical Emerald');
  }
});

test('text colors maintain WCAG AA contrast over every theme surface', () => {
  const surfaceNames = ['bg', 'surface', 'surface-2', 'surface-hover', 'bg-elevated', 'surface-elevated', 'card', 'card-hover'];
  const textNames = ['text', 'text-2', 'text-secondary', 'text-muted'];
  for (const [label, theme] of [['light', light], ['dark', dark]] as const) {
    for (const foreground of textNames) {
      for (const background of surfaceNames) {
        const ratio = contrast(color(foreground, theme), color(background, theme));
        assert.ok(ratio >= 4.5, `${label} --${foreground} on --${background} must be >= 4.5:1 (got ${ratio.toFixed(2)}:1)`);
      }
    }
  }
});

test('primary, success, and danger text use accessible foreground and soft-surface pairings', () => {
  for (const theme of [light, dark]) {
    assert.ok(contrast('#ffffff', color('primary', theme)) >= 4.5, 'white on primary must be >= 4.5:1');
    assert.ok(contrast('#ffffff', color('primary-hover', theme)) >= 4.5, 'white on primary hover must be >= 4.5:1');
    assert.ok(contrast(color('on-success', theme), color('success', theme)) >= 4.5, 'solid Emerald control foreground must be >= 4.5:1');
    assert.ok(contrast(color('on-danger', theme), color('danger', theme)) >= 4.5, 'solid Crimson danger foreground must be >= 4.5:1');
    assert.ok(contrast(color('on-danger', theme), color('danger-hover', theme)) >= 4.5, 'solid Crimson danger hover foreground must be >= 4.5:1');
    assert.ok(contrast(color('success-text', theme), color('success-soft', theme)) >= 4.5, 'success text on success soft must be >= 4.5:1');
    assert.ok(contrast(color('danger-text', theme), color('danger-soft', theme)) >= 4.5, 'danger text on danger soft must be >= 4.5:1');
  }
});

test('shared permanently dark sidebar tokens meet AA for text, active state, and logout', () => {
  const sidebarTokens = ['sidebar-bg', 'sidebar-text', 'sidebar-muted', 'sidebar-active-bg', 'sidebar-active-ink', 'sidebar-active-border', 'sidebar-hover', 'sidebar-border', 'sidebar-logout-color'];
  for (const token of sidebarTokens) assert.ok(light[token], `shared --${token} is defined`);
  for (const token of sidebarTokens) assert.equal(dark[token], undefined, `--${token} remains shared across themes`);
  const background = color('sidebar-bg');
  for (const foreground of ['sidebar-text', 'sidebar-muted', 'sidebar-logout-color']) {
    const ratio = contrast(color(foreground), background);
    assert.ok(ratio >= 4.5, `sidebar --${foreground} on --sidebar-bg must be >= 4.5:1 (got ${ratio.toFixed(2)}:1)`);
  }
  assert.ok(contrast(color('sidebar-active-ink'), color('sidebar-active-bg')) >= 4.5, 'active sidebar ink must contrast against the active fill');
  assert.ok(contrast(color('sidebar-muted'), color('sidebar-hover')) >= 4.5, 'muted sidebar text must remain readable on hover');
});

test('legacy semantic tokens remain available and only the requested sidebar width changes', () => {
  const retained = ['phantom-black', 'editorial-white', 'phantom-red', 'deep-red', 'accent-pink', 'concrete-grey', 'soft-grey', 'mist-grey', 'primary', 'primary-hover', 'primary-active', 'primary-soft', 'primary-ink', 'on-primary', 'link', 'link-hover', 'accent', 'accent-pink-soft', 'chart-blue', 'chart-ice', 'chart-cyan', 'chart-slate', 'heat-0', 'heat-1', 'heat-2', 'heat-3', 'heat-4', 'success', 'success-hover', 'success-soft', 'success-border', 'success-text', 'warning', 'warning-hover', 'warning-soft', 'warning-border', 'warning-text', 'danger', 'danger-hover', 'danger-soft', 'danger-border', 'danger-text', 'info', 'info-hover', 'info-soft', 'info-border', 'info-text', 'bg', 'surface', 'surface-2', 'surface-hover', 'bg-elevated', 'surface-elevated', 'card', 'card-hover', 'text', 'text-2', 'text-secondary', 'text-muted', 'text-inverse', 'border', 'border-subtle', 'border-strong', 'border-focus', 'focus-ring'];
  for (const token of retained) assert.ok(light[token], `legacy --${token} token remains available`);
  assert.equal(light['sidebar-w'], '244px');
  for (const [token, value] of Object.entries({ touch: '44px', 'header-h': '78px', 'bottom-nav-h': '64px', 'sidebar-rail-w': '76px', 'content-max': '1560px' })) {
    assert.equal(light[token], value, `existing --${token} dimension is preserved`);
  }
});
