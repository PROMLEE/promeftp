// The file pane's name filter and toolbar layout rules. Pure functions, no DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fileToolbarItems, defaultHiddenToolbarItems, normalizeToolbarLayout, moveToolbarItem, setToolbarItemHidden, fileFilterMatcher,
  clampTreeRatio, fileTreeRatioDefault, breadcrumbSplit,
} = require('../file-view.js');

test('with nothing saved, every button is listed in the default order and the defaults are hidden', () => {
  for (const kind of ['remote', 'local']) {
    const layout = normalizeToolbarLayout(kind, undefined);
    assert.deepEqual(layout.order, fileToolbarItems[kind].map(item => item.id));
    assert.deepEqual([...layout.hidden].sort(), [...defaultHiddenToolbarItems[kind]].sort());
  }
});

test('a saved order and visibility are kept, and unknown or repeated ids are dropped', () => {
  const layout = normalizeToolbarLayout('local', {
    order: ['refresh', 'tree', 'gone', 'refresh', ...fileToolbarItems.local.map(item => item.id)],
    hidden: ['tree', 'gone'],
  });
  assert.equal(layout.order[0], 'refresh');
  assert.equal(layout.order[1], 'tree');
  assert.equal(layout.order.length, fileToolbarItems.local.length);
  assert.deepEqual(layout.hidden, ['tree']);
});

test('a button the saved layout never listed takes its default place and default visibility', () => {
  const saved = { order: fileToolbarItems.remote.map(item => item.id).filter(id => id !== 'filter' && id !== 'compare'), hidden: [] };
  const layout = normalizeToolbarLayout('remote', saved);
  assert.deepEqual(layout.order, fileToolbarItems.remote.map(item => item.id));
  assert.ok(layout.hidden.includes('compare'), 'compare is hidden by default');
  assert.ok(!layout.hidden.includes('filter'), 'filter is shown by default');
  assert.ok(!layout.hidden.includes('split-right'), 'a listed button keeps the saved visibility');
});

test('moving a button swaps it with its neighbour in the same group only', () => {
  const order = normalizeToolbarLayout('remote').order;
  const up = moveToolbarItem('remote', order, 'refresh', -1);
  assert.ok(up.indexOf('refresh') < up.indexOf('tree'));
  // compare is the last leading button; filter, the next button in the list, belongs to another group.
  assert.deepEqual(moveToolbarItem('remote', order, 'compare', 1), order);
  assert.deepEqual(moveToolbarItem('remote', order, 'back', -1), order);
  assert.deepEqual(moveToolbarItem('remote', order, 'missing', 1), order);
});

test('hiding and showing a button keeps the order', () => {
  const layout = normalizeToolbarLayout('local');
  const hidden = setToolbarItemHidden(layout, 'tree', true);
  assert.ok(hidden.hidden.includes('tree'));
  assert.deepEqual(hidden.order, layout.order);
  assert.ok(!setToolbarItemHidden(hidden, 'tree', false).hidden.includes('tree'));
});

test('the filter matches every word, ignoring case', () => {
  const match = fileFilterMatcher('Deploy LOG');
  assert.equal(match('deploy-2026.log'), true);
  assert.equal(match('deploy.txt'), false);
  assert.equal(fileFilterMatcher('   ')('anything'), true);
});

test('the filter matches decomposed Hangul names typed in composed form', () => {
  const stored = '배포 노트.md'.normalize('NFD');
  assert.equal(fileFilterMatcher('배포')(stored), true);
});

test('* and ? match a whole name, and other pattern characters are literal', () => {
  assert.equal(fileFilterMatcher('*.log')('deploy.log'), true);
  assert.equal(fileFilterMatcher('*.log')('deploy.log.gz'), false);
  assert.equal(fileFilterMatcher('report-??.csv')('report-01.csv'), true);
  assert.equal(fileFilterMatcher('report-??.csv')('report-1.csv'), false);
  assert.equal(fileFilterMatcher('a+b*')('a+b.txt'), true);
  assert.equal(fileFilterMatcher('a+b*')('aab.txt'), false);
  assert.equal(fileFilterMatcher('(x)*')('(x) copy'), true);
});

test('the folder tree share is clamped, and a missing or broken value falls back to the default', () => {
  assert.equal(clampTreeRatio(0.5), 0.5);
  assert.equal(clampTreeRatio(0.01), 0.15);
  assert.equal(clampTreeRatio(0.99), 0.7);
  assert.equal(clampTreeRatio(undefined), fileTreeRatioDefault);
  assert.equal(clampTreeRatio('nope'), fileTreeRatioDefault);
  assert.equal(clampTreeRatio('0.4'), 0.4);
});

test('breadcrumbs keep the root, the first folder and the last folders in view, with the middle behind an ellipsis', () => {
  const crumbs = [['/', '/'], ['home', '/home'], ['me', '/home/me'], ['work', '/home/me/work'], ['app', '/home/me/work/app'], ['src', '/home/me/work/app/src']];
  const split = breadcrumbSplit(crumbs, 2);
  assert.deepEqual(split.shown.map(item => item?.[0]), ['/', 'home', undefined, 'app', 'src']);
  assert.deepEqual(split.hidden.map(item => item[0]), ['me', 'work']);
  assert.deepEqual(breadcrumbSplit(crumbs, 4).shown, crumbs);
  assert.equal(breadcrumbSplit(crumbs, 4).hidden.length, 0);
});

test('a path too short to collapse is shown whole, and at least one trailing folder always stays', () => {
  const short = [['/', '/'], ['home', '/home']];
  assert.deepEqual(breadcrumbSplit(short, 1).shown, short);
  const deep = [['/', '/'], ['a', '/a'], ['b', '/a/b'], ['c', '/a/b/c']];
  const split = breadcrumbSplit(deep, 0);
  assert.deepEqual(split.shown.map(item => item?.[0]), ['/', 'a', undefined, 'c']);
});
