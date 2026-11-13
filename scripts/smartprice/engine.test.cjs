const { test } = require('node:test');
const assert = require('node:assert/strict');
const e = require('../../lib/smartprice/engine.cjs');
const ai = require('../../lib/smartprice/ai.cjs');

const db = e.openDatabase(':memory:');
e.seed(db);
const monitor = { id: 'monitor', role: 'monitor' };
const analyst = { id: 'analyst', role: 'analyst' };
const manager = { id: 'manager', role: 'manager' };

let tick = 0;
const observation = (extra = {}) => ({
  product_id: 'oil',
  store_id: 'store-0',
  amount: 1100,
  collected_at: new Date(Date.now() - 100000 + tick++ * 1000).toISOString(),
  source: 'manual',
  ...extra,
});

test('seed has 16 distinct packages, 20 regions and multi-store persisted history', () => {
  const snap = e.snapshot(db, monitor);
  assert.equal(snap.products.length, 16);
  assert.equal(snap.prices.length >= 8960, true);
  assert.equal(snap.stores.length, 28);
  assert.equal(e.regions.length, 20);
});

test('normalizes 900 ml and litre; computes 29.41% rise and MAD Z-Score', () => {
  assert.equal(e.normalize(450, { quantity: 0.9 }), 500);
  assert.equal(e.change(1100, 850), 29.41);
  assert.equal(e.analyze(1100, 850).anomaly, true);
  assert.equal(e.analyze(840, 850).anomaly, false);
  assert.equal(e.analyze(1400, null, [850, 900, 800]).reason, 'market');
  assert.equal(e.analyze(700, 1000).anomaly, true);
  // Tight peer cluster where +8% is statistically extreme by MAD Z-Score (>= 3.5)
  const tight = e.analyze(540, 500, [500, 502, 499, 501, 500]);
  assert.equal(tight.anomaly, true);
  assert.equal(tight.reason, 'zscore');
  assert.equal(tight.zScore > 3.5, true);
});

test('server-enforced roles reject forged writes and reviews', () => {
  assert.throws(() => e.mutate(db, manager, 'prices', observation()), /forbidden/);
  assert.throws(() => e.mutate(db, monitor, 'review', { id: 'x', status: 'verified', comment: 'ok' }), /forbidden/);
  assert.throws(() => e.mutate(db, analyst, 'stores', { name: 'x' }), /forbidden/);
  assert.throws(() => e.saveAiConfig(db, manager, { model: 'x' }), /forbidden/);
});

test('validates price, time, references and duplicate observations', () => {
  for (const amount of [0, -1, NaN, Infinity, 10000001]) {
    assert.throws(() => e.mutate(db, monitor, 'prices', observation({ amount })), /invalid_price/);
  }
  assert.throws(() => e.mutate(db, monitor, 'prices', observation({ collected_at: 'bad' })), /invalid_date/);
  assert.throws(() => e.mutate(db, monitor, 'prices', observation({ collected_at: '2099-01-01' })), /invalid_date/);
  assert.throws(() => e.mutate(db, monitor, 'prices', observation({ store_id: 'missing' })), /store_missing/);
  const p = observation();
  e.mutate(db, monitor, 'prices', p);
  assert.throws(() => e.mutate(db, monitor, 'prices', p), /duplicate/);
});

test('import is atomic, including audit records', () => {
  const before = db.prepare('select count(*) n from prices').get().n;
  const auditCount = db.prepare('select count(*) n from audit').get().n;
  assert.throws(() => e.mutate(db, monitor, 'import', { rows: [observation(), observation({ amount: -1 })] }), /invalid_price\|3/);
  assert.equal(db.prepare('select count(*) n from prices').get().n, before);
  assert.equal(db.prepare('select count(*) n from audit').get().n, auditCount);
});

test('previewImport classifies valid, error, exact duplicate and same-day duplicate without mutating DB', () => {
  const before = db.prepare('select count(*) n from prices').get().n;
  const ts = new Date(Date.now() - 35 * 86400000).toISOString();
  const res = e.previewImport(db, [
    { product_id: 'milk900', store_id: 'store-0', amount: 450, collected_at: ts, source: 'csv' },
    { product_id: 'milk900', store_id: 'store-0', amount: 450, collected_at: ts, source: 'csv' },
    {
      product_id: 'milk900',
      store_id: 'store-0',
      amount: 460,
      collected_at: new Date(new Date(ts).getTime() + 1000).toISOString(),
      source: 'csv',
    },
    { product_id: 'oil', store_id: 'store-0', amount: -10, collected_at: ts, source: 'csv' },
  ]);
  assert.equal(res[0].status, 'valid');
  assert.equal(res[0].normalized, 500);
  assert.equal(res[1].status, 'duplicate_exact');
  assert.equal(res[2].status, 'duplicate_day');
  assert.equal(res[3].status, 'error');
  assert.equal(db.prepare('select count(*) n from prices').get().n, before);
});

test('workflow saves anomaly, comment, verification and audit', () => {
  const p = e.mutate(db, monitor, 'prices', observation({ amount: 2200 }));
  assert.equal(p.anomaly, true);
  e.mutate(db, monitor, 'comment', { id: p.id, comment: 'Photo requested', escalate: true });
  e.mutate(db, analyst, 'review', { id: p.id, status: 'verified', comment: 'Price label inspected' });
  const row = e.snapshot(db, manager).prices.find((x) => x.id === p.id);
  assert.equal(row.status, 'verified');
  assert.equal(e.detail(db, p.id).comments.length, 2);
  assert.throws(() => e.mutate(db, monitor, 'price-edit', { id: p.id, amount: 1 }), /locked/);
  assert.equal(db.prepare('select count(*) n from audit where entity_id=?').get(p.id).n, 3);
});

test('store CRUD preserves referenced stores and checks GPS', () => {
  const body = { name: 'DEMO test', type: 'market', region: 'astana', city: 'Astana', address: '', lat: '', lng: '', monitoring: true };
  const { id } = e.mutate(db, monitor, 'stores', body);
  e.mutate(db, monitor, 'stores', { ...body, id, name: 'Renamed' });
  assert.equal(db.prepare('select name from stores where id=?').get(id).name, 'Renamed');
  assert.throws(() => e.mutate(db, monitor, 'stores', { ...body, lat: 0, lng: 0 }), /invalid_coordinates/);
  e.mutate(db, monitor, 'stores', { id, delete: true });
  assert.throws(() => e.mutate(db, monitor, 'stores', { id: 'store-0', delete: true }), /store_in_use/);
});

test('evidence validates signatures, ownership linkage and audit', () => {
  const p = e.mutate(db, monitor, 'prices', observation());
  assert.throws(
    () => e.mutate(db, monitor, 'evidence', { id: p.id, mime: 'image/png', base64: Buffer.from('not an image data').toString('base64') }),
    /invalid_image/
  );
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrWQAAAAASUVORK5CYII=';
  e.mutate(db, monitor, 'evidence', { id: p.id, mime: 'image/png', base64: png, comment: 'label' });
  assert.equal(e.detail(db, p.id).evidence.length, 1);
});

test('sessions are server-owned and expire', () => {
  const { token, user } = e.login(db, 'analyst');
  assert.equal(e.getUser(db, token).role, 'analyst');
  assert.equal(user.id, 'analyst');
  assert.throws(() => e.getUser(db, 'forged'), /unauthorized/);
  db.prepare('update sessions set expires=?').run('2000-01-01');
  assert.throws(() => e.getUser(db, token), /unauthorized/);
});

test('matching refuses incompatible units and fat while preserving separate sizes', () => {
  const a = { family: 'milk', unit: 'l', category: 'dairy', name: 'Молоко 2.5%', brand: 'A', manufacturer: 'A', fat: 2.5, packaging: 'pack', quantity: 1 };
  assert.equal(e.similarity(a, { ...a, quantity: 0.9 }), 100);
  assert.equal(e.similarity(a, { ...a, unit: 'kg' }), 0);
  assert.equal(e.similarity(a, { ...a, fat: 3.2 }), 0);
});

test('data survives closing and reopening SQLite', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'smartprice-test-'));
  const file = path.join(folder, 'test.sqlite');
  let d = e.openDatabase(file);
  d.prepare('insert into settings values(?,?)').run('persist', 'ok');
  d.close();
  d = e.openDatabase(file);
  assert.equal(d.prepare('select value from settings where key=?').get('persist').value, 'ok');
  d.close();
  fs.rmSync(folder, { recursive: true, force: true });
});

test('basket, Min/Median/Max, Holt 7-day forecast and shrinkflation metrics work accurately', async () => {
  const m = await import('../../lib/smartprice/metrics-core.mjs');
  const prices = [
    { product_id: 'a', family: 'a', store_id: 's1', store_name: 'S1', region: 'astana', normalized: 100, delta: 0, collected_at: '2026-01-01', status: 'verified' },
    { product_id: 'b', family: 'b', store_id: 's1', store_name: 'S1', region: 'astana', normalized: 200, delta: 0, collected_at: '2026-01-01', status: 'verified' },
    { product_id: 'a', family: 'a', store_id: 's1', store_name: 'S1', region: 'astana', normalized: 150, delta: 50, collected_at: '2026-01-02', status: 'verified' },
    { product_id: 'a', family: 'a', store_id: 's2', store_name: 'S2', region: 'astana', normalized: 180, delta: 0, collected_at: '2026-01-02', status: 'verified' },
    { product_id: 'a', family: 'a', store_id: 's3', store_name: 'S3', region: 'astana', normalized: 210, delta: 0, collected_at: '2026-01-02', status: 'verified' },
  ];
  assert.deepEqual(
    m.baskets(prices, [{ family: 'a' }, { family: 'b' }]).map((x) => x.value),
    [300, 380]
  );
  assert.equal(m.baskets(prices, [{ family: 'a' }, { family: 'missing' }])[0].value, null);
  assert.equal(m.latestPrices([...prices, { ...prices[2], normalized: 999, collected_at: '2026-01-03', status: 'rejected' }]).find((x) => x.product_id === 'a' && x.store_id === 's1').normalized, 150);

  const stats = m.computeMinMedianMax(m.latestPrices(prices).filter((x) => x.product_id === 'a'), 'normalized');
  assert.equal(stats.min, 150);
  assert.equal(stats.median, 180);
  assert.equal(stats.max, 210);

  const fc = m.forecastSeries([
    { day: '2026-01-01', value: 1000 },
    { day: '2026-01-02', value: 1020 },
    { day: '2026-01-03', value: 1040 },
    { day: '2026-01-04', value: 1060 },
  ], 7);
  assert.equal(fc.series.filter((x) => x.isForecast).length, 7);
  assert.equal(fc.summary.forecastEnd > 1060, true);
});

test('AI helper strips <think>, extracts JSON and parses OCR price tags deterministically', () => {
  const cleaned = ai.stripThinking('<think>reasoning</think>\n{"ok":true}');
  assert.equal(cleaned, '{"ok":true}');
  assert.deepEqual(ai.extractJson('<think>hmm</think>```json\n{"a":1}\n```'), { a: 1 });
  const products = e.snapshot(db, monitor).products;
  const parsed = ai.deterministicParsePriceText('MOJIOKO 2.5% 900 МЛ ЦЕНА: 450 ТГ', products);
  assert.equal(parsed.productId, 'milk900');
  assert.equal(parsed.amount, 450);
  assert.equal(parsed.normalizedPerUnit, 500);
});

test('CSV handles BOM, quotes, commas and embedded newlines', () => {
  assert.deepEqual(e.parseCsv('\uFEFFa,b\r\n"one,two","three""four"\n"line\nbreak",2\n'), [
    ['a', 'b'],
    ['one,two', 'three"four'],
    ['line\nbreak', '2'],
  ]);
  assert.throws(() => e.parseCsv('a,b\n"unterminated'), /invalid_import/);
});
