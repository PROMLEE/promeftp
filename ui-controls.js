const defaultTerminal = { font: 'Menlo', size: 13, scrollback: 20000, unlimited: false, optionMeta: false, opacity: 100 };

function terminalFont(font) {
  if (font === 'system-monospace') return 'ui-monospace, Menlo, monospace';
  return '"' + font.replace(/["\\]/g, '') + '", "MesloLGS NF", "Symbols Nerd Font Mono", Menlo, monospace';
}
function button(text, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.addEventListener('click', action);
  return element;
}

const icons = {
  settings: 'M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-6 1v4',
  sidebar: 'M3 4h18v16H3z M9 4v16',
  plus: 'M12 5v14 M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  terminal: 'm5 7 5 5-5 5m8 0h6',
  trigger: 'M13 2 4 14h7l-1 8 10-12h-7z',
  transfer: 'M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4',
  workspaces: 'M4 8h16v12H4z M7 4h10m-6 9h2m-5 3h8',
  splitRight: 'M3 4h18v16H3z M12 4v16',
  splitDown: 'M3 4h18v16H3z M3 12h18',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  layout: 'M3 4h18v16H3z M3 9h18m-9 0v11',
  code: 'm9 6-6 6 6 6m6-12 6 6-6 6',
  sshConfig: 'M5 3h9l5 5v13H5z M14 3v6h5 M8 12l2 2-2 2m4 0h4',
  type: 'M3 18 8 6l5 12M5 14h6m3-2h7m-3.5 0v6',
  columns: 'M4 4h16v16H4z M10 4v16m5-16v16M4 10h6m5 4h5',
  tree: 'M4 4h4v4H4z M6 8v11h5m-5-6h5m0-2h8v4h-8zm0 6h8v4h-8z',
  history: 'M4 9a8 8 0 1 1 0 7M4 4v5h5m3-2v5l3 2',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
  image: 'M3 4h18v16H3z M3 16l5-5 4 4 3-3 6 6 M16 8h.01',
  archive: 'M5 3h14v18H5z M11 3v2h2v2h-2v2h2v2h-2m0 3h3v4h-3z',
  audio: 'M9 18V6l10-2v12M9 18c0 3-6 3-6 0s6-3 6 0zm10-2c0 3-6 3-6 0s6-3 6 0z',
  video: 'M3 5h18v14H3z M10 9l5 3-5 3z',
  document: 'M5 3h14v18H5z M8 8h8m-8 4h8m-8 4h5',
  sheet: 'M4 4h16v16H4z M4 9h16M4 14h16M10 9v11',
  folderPlus: 'M3 6h7l2 2h9v11H3z M12 10v7m-3-3.5h6',
  folder: 'M3 6h7l2 2h9v11H3z',
  file: 'M5 3h9l5 5v13H5z M14 3v6h5',
  bookmark: 'M6 4h12v16l-6-4-6 4z',
  trash: 'M4 7h16m-14 0 1 13h10l1-13M9 7V4h6v3m-5 4v5m4-5v5',
  refresh: 'M20 7v5h-5m5 0a8 8 0 1 0-2 5',
  search: 'M16 16l4 4M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  up: 'M12 20V4m-6 6 6-6 6 6',
  chevronDown: 'm6 9 6 6 6-6',
  down: 'M12 4v16m-6-6 6 6 6-6',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm-3-13a3 3 0 1 1 5.5 1.6c-1.3 1.4-2.5 1.5-2.5 3.4m0 3h.01',
  right: 'M4 12h16m-6-6 6 6-6 6',
  left: 'M20 12H4m6-6-6 6 6 6',
  eyeOff: 'M3 3l18 18M10 10a3 3 0 0 0 4 4M5 7c-2 2-3 5-3 5s4 6 10 6c2 0 4-.5 5.5-1.5M9 6.5c1-.3 2-.5 3-.5 6 0 10 6 10 6s-.7 1-2 2.3',
  eye: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'm4 16 12-12 4 4L8 20H4z m10-10 4 4',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
  chevron: 'm8 5 7 7-7 7',
  network: 'M3 5h18v5H3z M3 14h18v5H3z M6 7.5h.01M6 16.5h.01',
  link: 'm10 14 4-4m-6 7-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m5-3 2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0',
  pause: 'M8 5v14M16 5v14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-11v5.5m0-8.5h.01',
  key: 'M15 7a4 4 0 1 0-4 4l-7 7v3h3v-2h2v-2h2l2.2-2.2A4 4 0 0 0 15 7zm1.5-.5h.01',
  compare: 'M3 5h7v14H3z M14 5h7v14h-7z M10 9h4m-1.5-1.5L14 9l-1.5 1.5M14 15h-4m1.5-1.5L10 15l1.5 1.5',
  play: 'M7 5l11 7-11 7z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  alert: 'M12 3 2.5 20h19zM12 10v4.5m0 3h.01',
};
const svgNS = 'http://www.w3.org/2000/svg';
function icon(name) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', ['more', 'grip'].includes(name) ? '3' : '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', icons[name]);
  svg.append(path);
  return svg;
}
function iconButton(name, hint, action) {
  const control = button('', action);
  control.classList.add('icon-button');
  control.title = t(hint);
  control.setAttribute('aria-label', t(hint));
  control.append(icon(name));
  return control;
}
function passwordField(field, showHint = 'Show answer', hideHint = 'Hide answer') {
  const wrap = document.createElement('div');
  wrap.className = 'password-field';
  const eye = iconButton('eye', showHint, () => {
    const reveal = field.type === 'password';
    field.type = reveal ? 'text' : 'password';
    const hint = reveal ? hideHint : showHint;
    eye.title = t(hint);
    eye.setAttribute('aria-label', t(hint));
    eye.setAttribute('aria-pressed', String(reveal));
    eye.replaceChildren(icon(reveal ? 'eyeOff' : 'eye'));
  });
  eye.setAttribute('aria-pressed', 'false');
  wrap.append(field, eye);
  return wrap;
}

// Info tips: one shared layer in the top layer (above dialogs, never clipped by overflow).
// Hover or keyboard focus shows a tip after a short delay; a click pins it; outside click, Escape, scrolling, resizing and window blur close it.
// Only one tip is open at a time.
let tipLayer;
let tipState = null; // { trigger, pinned }
let tipTimer = 0;
function tooltipLayer() {
  if (!tipLayer) {
    tipLayer = document.createElement('div');
    tipLayer.id = 'tooltip-layer';
    tipLayer.setAttribute('popover', 'manual');
    tipLayer.setAttribute('role', 'tooltip');
    tipLayer.addEventListener('mouseenter', () => clearTimeout(tipTimer));
    tipLayer.addEventListener('mouseleave', () => scheduleTipClose());
    document.body.append(tipLayer);
  }
  return tipLayer;
}
function placeTooltip(trigger) {
  const layer = tooltipLayer();
  const anchor = trigger.getBoundingClientRect();
  const width = layer.offsetWidth;
  const height = layer.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  let top = anchor.bottom + 6;
  if (top + height > vh - 8) top = Math.max(8, anchor.top - height - 6);
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), vw - width - 8);
  layer.style.left = `${Math.round(left)}px`;
  layer.style.top = `${Math.round(top)}px`;
}
function showTip(trigger, pinned) {
  const layer = tooltipLayer();
  if (tipState && tipState.trigger !== trigger) hideTip();
  clearTimeout(tipTimer);
  layer.textContent = t(trigger.dataset.tipText);
  if (!layer.matches(':popover-open')) layer.showPopover();
  placeTooltip(trigger);
  tipState = { trigger, pinned: pinned || Boolean(tipState?.pinned && tipState.trigger === trigger) };
  trigger.setAttribute('aria-expanded', String(tipState.pinned));
  layer.id = 'tooltip-layer';
  trigger.setAttribute('aria-describedby', layer.id);
}
function hideTip() {
  clearTimeout(tipTimer);
  if (tipLayer?.matches(':popover-open')) tipLayer.hidePopover();
  if (tipState) tipState.trigger.setAttribute('aria-expanded', 'false');
  tipState = null;
}
function scheduleTipClose() {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => { if (!tipState?.pinned) hideTip(); }, 150);
}
function infoTip(text) {
  const wrap = document.createElement('span');
  wrap.className = 'info-tip';
  // A span, not a button: a disabled fieldset disables its buttons, and the reason for a disabled field must stay readable.
  const trigger = document.createElement('span');
  trigger.setAttribute('role', 'button');
  trigger.tabIndex = 0;
  trigger.className = 'info-tip-button';
  // Not data-tip: attachInfoTips selects [data-tip] and would turn every trigger into a new tip.
  trigger.dataset.tipText = text;
  trigger.setAttribute('aria-label', t('More information'));
  trigger.setAttribute('aria-expanded', 'false');
  if (typeof staticStrings !== 'undefined') staticStrings.push(() => trigger.setAttribute('aria-label', t('More information')));
  const svg = icon('info');
  svg.setAttribute('stroke-width', '1.4');
  trigger.append(svg);
  let hoverTimer = 0;
  trigger.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer);
    hoverTimer = setTimeout(() => { if (!tipState?.pinned) showTip(trigger, false); }, 120);
  });
  trigger.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); scheduleTipClose(); });
  trigger.addEventListener('focus', () => { if (!tipState?.pinned) showTip(trigger, false); });
  trigger.addEventListener('blur', () => { if (!tipState?.pinned) hideTip(); });
  // A click pins the tip and must not toggle the control of an enclosing label.
  trigger.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (tipState?.trigger === trigger && tipState.pinned) hideTip();
    else showTip(trigger, true);
  });
  trigger.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    trigger.click();
  });
  wrap.addEventListener('click', event => event.preventDefault());
  wrap.append(trigger);
  return wrap;
}
// Turns every [data-tip] element under root into an info tip next to it.
// A tip on a field inside a label belongs to the label: it sits beside the label text, before a text field or after a checkbox.
function attachInfoTips(root = document) {
  const labelControl = label => {
    const control = label.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea');
    return control && control.parentElement === label ? control : null;
  };
  for (const host of root.querySelectorAll('[data-tip]')) {
    const tip = infoTip(host.dataset.tip);
    host.removeAttribute('data-tip');
    if (host.type === 'radio' || host.querySelector?.('input[type=radio]')) {
      // Radio segments must stay clean: a tip inside one would sit in the option and could change its value.
      console.warn('Info tip inside a radio label was moved to its group heading:', host);
    }
    const label = host.tagName === 'LABEL' ? host : host.closest('label');
    if (label && !(host.type === 'radio')) label.insertBefore(tip, labelControl(label));
    else if (host.tagName === 'H3') host.append(tip);
    else {
      host.after(tip);
      // A tip that belongs to a control hides with it.
      const sync = () => { tip.hidden = host.hidden; };
      sync();
      new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ['hidden'] });
    }
  }
}
// A press or click outside the tip and its trigger closes a pinned tip.
const closePinnedTipOutside = event => {
  if (!tipState?.pinned) return;
  if (event.target.closest?.('.info-tip-button') || event.target.closest?.('#tooltip-layer')) return;
  hideTip();
};
document.addEventListener('pointerdown', closePinnedTipOutside);
document.addEventListener('click', closePinnedTipOutside);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && tipState) hideTip(); });
window.addEventListener('blur', () => hideTip());
window.addEventListener('resize', () => { if (tipState) hideTip(); });
document.addEventListener('scroll', () => { if (tipState) hideTip(); }, true);
