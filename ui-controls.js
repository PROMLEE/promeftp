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
