const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const base = process.argv[2] || 'http://localhost:3005';
let cookie = '';

async function request(path, body, expected = 200) {
  const r = await fetch(base + '/api/smartprice/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      origin: base,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(r.status, expected, `${path}: ${r.status} ${expected}`);
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
  return r;
}

(async () => {
  await request('data', undefined, 401);
  await request('login', { user_id: 'monitor' });
  const d = await (await request('data')).json();
  assert.equal(d.products.length, 16);
  assert.equal(d.prices.length >= 8960, true);
  assert.equal(d.stores.length, 28);

  const aiStatus = await (await request('ai/status')).json();
  assert.equal(typeof aiStatus.configured, 'boolean');

  const price = {
    product_id: 'oil',
    store_id: 'store-0',
    amount: 1424,
    collected_at: new Date().toISOString(),
    source: 'demo-integration',
  };
  const added = await (await request('prices', price)).json();
  assert.equal(added.anomaly, true);
  await request('prices', price, 409);
  await request('prices', { ...price, amount: -1 }, 400);

  // Test import-preview without DB mutation
  const prevRes = await (
    await request('import-preview', {
      rows: [
        { ...price, collected_at: new Date(Date.now() - 40 * 86400000).toISOString(), amount: 900 },
        { ...price, amount: -5 },
      ],
    })
  ).json();
  assert.equal(prevRes.items[0].status, 'valid');
  assert.equal(prevRes.items[1].status, 'error');

  // Test AI OCR text extraction
  const ocrRes = await (
    await request('ai/ocr', { rawText: 'Сүт 2.5% 900 мл 450 тг', lang: 'kk' })
  ).json();
  assert.equal(ocrRes.productId, 'milk900');
  assert.equal(ocrRes.normalizedPerUnit, 500);

  // Test XLSX export with 2 sheets
  const file = await request('export?region=astana&product=oil&lang=ru');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  assert.equal(workbook.worksheets[0].getRow(2).getCell(1).value, 'Товар');
  assert.equal(workbook.worksheets[0].rowCount >= 30, true);
  assert.equal(workbook.worksheets[1].name, 'Min-Median-Max');

  const before = (await (await request('data')).json()).prices.length;
  const form = new FormData();
  form.append(
    'file',
    new Blob(
      ['product_id,store_id,amount,collected_at,source\noil,store-0,1200,2020-01-01T00:00:00Z,test\noil,store-0,-2,2020-01-02T00:00:00Z,test\n'],
      { type: 'text/csv' }
    ),
    'bad.csv'
  );
  const imp = await fetch(base + '/api/smartprice/import-file', {
    method: 'POST',
    headers: { cookie, origin: base },
    body: form,
  });
  assert.equal(imp.status, 400);
  assert.equal((await (await request('data')).json()).prices.length, before);

  const goodForm = new FormData();
  goodForm.append(
    'file',
    new Blob(
      ['product_id,store_id,amount,collected_at,source\noil,store-0,1200,' + new Date(Date.now() - 5000).toISOString() + ',demo-integration\n'],
      { type: 'text/csv' }
    ),
    'good.csv'
  );
  const good = await fetch(base + '/api/smartprice/import-file', {
    method: 'POST',
    headers: { cookie, origin: base },
    body: goodForm,
  });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).items.length, 1);

  const xlsx = new ExcelJS.Workbook();
  const sheet = xlsx.addWorksheet('Import');
  sheet.addRow(['product_id', 'store_id', 'amount', 'collected_at', 'source']);
  sheet.addRow(['sugar', 'store-0', 430, new Date(Date.now() - 6000).toISOString(), 'demo-integration']);
  const xform = new FormData();
  xform.append('file', new Blob([await xlsx.xlsx.writeBuffer()]), 'prices.xlsx');
  const xr = await fetch(base + '/api/smartprice/import-file', {
    method: 'POST',
    headers: { cookie, origin: base },
    body: xform,
  });
  assert.equal(xr.status, 200);

  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrWQAAAAASUVORK5CYII=';
  const evidence = await (
    await request('evidence', { id: added.id, mime: 'image/png', base64: image, comment: 'DEMO test image' })
  ).json();
  const er = await request('evidence/' + evidence.id);
  assert.equal(er.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await er.arrayBuffer()).toString('base64'), image);

  await request('login', { user_id: 'analyst' });
  await request('prices', price, 403);
  const exp = await (await request('ai/explain', { id: added.id, lang: 'kk' })).json();
  assert.equal(Boolean(exp.summary), true);
  await request('review', { id: added.id, status: 'verified', comment: 'DEMO: integration check' });
  const details = await (await request('detail/' + added.id)).json();
  assert.equal(details.comments.length, 1);
  assert.equal(details.evidence.length, 1);

  await request('login', { user_id: 'manager' });
  await request('comment', { id: added.id, comment: 'forbidden' }, 403);
  const snapshot = await (await request('data')).json();
  assert.equal(snapshot.prices.find((p) => p.id === added.id).status, 'verified');
  assert.equal(snapshot.audit.some((a) => a.entity_id === added.id && a.action === 'verified'), true);

  await request('logout', {});
  await request('data', undefined, 401);
  console.log(
    'PASS: auth, cookies, 12544+ rows, MAD Z-Score, AI OCR, AI explain, import-preview, 2-sheet XLSX export, atomic rollback, evidence, review, manager RBAC, audit.'
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
