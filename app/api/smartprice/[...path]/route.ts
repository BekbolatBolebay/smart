import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import * as engine from '@/lib/smartprice/engine.cjs';
import * as ai from '@/lib/smartprice/ai.cjs';
import { latestPrices, computeProductSummaryTable } from '@/lib/smartprice/metrics';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function serverlessSecret() {
  return (
    process.env.SMARTPRICE_SESSION_SECRET ||
    process.env.AI_API_KEY ||
    process.env.VERCEL_PROJECT_ID ||
    'smartprice-serverless-demo-secret'
  );
}

function signServerlessToken(userId: string, expMs: number) {
  const payload = `${userId}.${expMs}`;
  const sig = createHmac('sha256', serverlessSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function resolveRequestUser(conn: any, req: NextRequest) {
  const tok = req.cookies.get('sp_session')?.value;
  try {
    return engine.getUser(conn, tok);
  } catch (err) {
    if (!IS_SERVERLESS || !tok) throw err;
    const vtok = req.cookies.get('sp_vtoken')?.value;
    if (!vtok) throw err;
    const existing = conn.prepare('SELECT 1 FROM sessions WHERE token=?').get(engine.hash(tok));
    if (existing) throw err;
    const parts = vtok.split('.');
    if (parts.length !== 3) throw err;
    const [userId, expStr, sigHex] = parts;
    const expMs = Number(expStr);
    if (!Number.isFinite(expMs) || expMs <= Date.now()) throw err;
    const expected = createHmac('sha256', serverlessSecret()).update(`${userId}.${expStr}`).digest('hex');
    const a = Buffer.from(sigHex, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw err;
    const user = conn.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!user) throw err;
    conn
      .prepare('INSERT OR IGNORE INTO sessions VALUES(?,?,?)')
      .run(engine.hash(tok), user.id, new Date(expMs).toISOString());
    return user;
  }
}

let db: any;
function database() {
  if (!db) {
    db = engine.openDatabase();
    engine.seed(db);
  }
  return db;
}

function failure(e: any) {
  console.error('[smartprice]', e.message);
  return NextResponse.json(
    { error: e.status ? e.message : 'server_error', detail: e.status ? undefined : String(e.message || '') },
    { status: e.status || 500 }
  );
}

function checkOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const originHost = new URL(origin).host;
  const forwardedHost = req.headers.get('x-forwarded-host');
  if (originHost !== req.headers.get('host') && originHost !== forwardedHost) {
    throw new engine.AppError('forbidden', 403);
  }
}

async function parseSpreadsheetToRows(file: File) {
  const workbook = new ExcelJS.Workbook();
  let sheet: any;
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    await workbook.xlsx.load(await file.arrayBuffer());
    sheet = workbook.worksheets[0];
  } else if (file.name.toLowerCase().endsWith('.csv')) {
    sheet = workbook.addWorksheet('Import');
    engine.parseCsv(await file.text()).forEach((row: string[]) => sheet.addRow(row));
  } else {
    throw new engine.AppError('invalid_import');
  }
  if (!sheet || sheet.rowCount > 1001) throw new engine.AppError('invalid_import');
  const headers = ['product_id', 'store_id', 'amount', 'collected_at', 'source'];
  const actual = sheet.getRow(1).values.slice(1).map(String);
  if (!headers.every((h, i) => actual[i]?.trim() === h)) throw new engine.AppError('import_headers');
  const rows: any[] = [];
  sheet.eachRow((row: any, i: number) => {
    if (i === 1) return;
    const r: any = {};
    headers.forEach((h, j) => {
      const v = row.getCell(j + 1).value;
      r[h] = v instanceof Date ? v.toISOString() : v;
    });
    rows.push(r);
  });
  return rows;
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    const conn = database();
    const user = resolveRequestUser(conn, req);
    const [kind, id] = params.path;

    if (kind === 'data') {
      return NextResponse.json(engine.snapshot(conn, user), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (kind === 'detail') {
      return NextResponse.json(engine.detail(conn, id));
    }
    if (kind === 'ai' && id === 'status') {
      const cfg = engine.getAiConfig(conn);
      return NextResponse.json({
        configured: cfg.configured,
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        visionModel: cfg.visionModel,
        source: cfg.source,
        maskedKey: cfg.maskedKey,
      });
    }
    if (kind === 'evidence') {
      const e = conn.prepare('SELECT * FROM evidence WHERE id=?').get(id);
      if (!e) throw new engine.AppError('not_found', 404);
      return new NextResponse(e.bytes, {
        headers: {
          'Content-Type': e.mime,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
        },
      });
    }
    if (kind === 'export') {
      const lang = req.nextUrl.searchParams.get('lang') || 'ru';
      const labels =
        lang === 'en'
          ? ['Product', 'Store', 'Region', 'Package price KZT', 'Previous KZT', 'Change %', 'Unit price KZT', 'Unit', 'Collected at', 'Source', 'Status']
          : lang === 'kk'
          ? ['Тауар', 'Сауда нүктесі', 'Өңір', 'Баға KZT', 'Алдыңғы KZT', 'Өзгеріс %', 'Бірлік бағасы KZT', 'Өлшем', 'Жиналған күні', 'Дереккөз', 'Мәртебе']
          : ['Товар', 'Торговая точка', 'Регион', 'Цена KZT', 'Предыдущая KZT', 'Изменение %', 'Цена за единицу KZT', 'Единица', 'Дата сбора', 'Источник', 'Статус'];

      const snap = engine.snapshot(conn, user);
      const param = (s: string) => req.nextUrl.searchParams.get(s);
      const prices = snap.prices.filter(
        (p: any) =>
          (!param('region') || p.region === param('region')) &&
          (!param('product') || p.product_id === param('product')) &&
          (!param('store') || p.store_id === param('store')) &&
          (!param('from') || p.collected_at >= param('from')!) &&
          (!param('to') || p.collected_at.slice(0, 10) <= param('to')!)
      );

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('SMART PRICE DEMO');
      sheet.addRow(['SMART PRICE — DEMO / Тестовые данные']);
      sheet.addRow(labels);
      sheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF142C4C' } };
      for (const p of prices) {
        sheet.addRow([
          lang === 'en' ? p.name_en : lang === 'kk' ? p.name_kk : p.name,
          p.store_name,
          p.region,
          p.amount,
          p.previous,
          p.delta,
          p.normalized,
          p.unit,
          p.collected_at,
          p.source,
          p.status,
        ]);
      }
      sheet.columns.forEach((c) => {
        c.width = 25;
      });
      sheet.views = [{ state: 'frozen', ySplit: 2 }];

      // Sheet 2: Product Min / Median / Max summary
      const summarySheet = workbook.addWorksheet('Min-Median-Max');
      const sumHeaders =
        lang === 'kk'
          ? ['Тауар', 'Өлшем', 'Бақылау', 'Ең төмен (Min)', 'Медиана (Median)', 'Ең жоғары (Max)', 'Айырма %']
          : lang === 'en'
          ? ['Product', 'Unit', 'Observations', 'Min', 'Median', 'Max', 'Spread %']
          : ['Товар', 'Единица', 'Наблюдений', 'Мин (Min)', 'Медиана (Median)', 'Макс (Max)', 'Разброс %'];
      summarySheet.addRow(['SMART PRICE — Min / Median / Max']);
      summarySheet.addRow(sumHeaders);
      summarySheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      summarySheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B887D' } };
      const summaryRows = computeProductSummaryTable(latestPrices(prices), snap.products);
      for (const s of summaryRows) {
        summarySheet.addRow([
          lang === 'en' ? s.product.name_en : lang === 'kk' ? s.product.name_kk : s.product.name,
          s.product.unit,
          s.count,
          s.min,
          s.median,
          s.max,
          s.spreadPct,
        ]);
      }
      summarySheet.columns.forEach((c) => {
        c.width = 22;
      });

      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(buffer as any, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="smart-price-demo.xlsx"',
        },
      });
    }
    throw new engine.AppError('not_found', 404);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    checkOrigin(req);
    if (Number(req.headers.get('content-length')) > 7500000) throw new engine.AppError('too_large', 413);
    const conn = database();
    const [kind, sub] = params.path;

    if (kind === 'login') {
      if (process.env.SMARTPRICE_DEMO_LOGIN === 'false') throw new engine.AppError('demo_disabled', 403);
      const body = await req.json();
      const { user, token } = engine.login(conn, body.user_id);
      const secure = req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
      const res = NextResponse.json({ user });
      res.cookies.set('sp_session', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure,
        path: '/',
        maxAge: 86400,
      });
      if (IS_SERVERLESS) {
        res.cookies.set('sp_vtoken', signServerlessToken(user.id, Date.now() + 86400000), {
          httpOnly: true,
          sameSite: 'strict',
          secure,
          path: '/',
          maxAge: 86400,
        });
      }
      return res;
    }

    const user = resolveRequestUser(conn, req);

    if (kind === 'logout') {
      const tok = req.cookies.get('sp_session')?.value;
      if (tok) conn.prepare('DELETE FROM sessions WHERE token=?').run(engine.hash(tok));
      const res = NextResponse.json({ ok: true });
      res.cookies.delete('sp_session');
      res.cookies.delete('sp_vtoken');
      return res;
    }

    if (kind === 'import-file') {
      if (user.role !== 'monitor') throw new engine.AppError('forbidden', 403);
      const form = await req.formData();
      const file = form.get('file') as File;
      if (!file || file.size > 5 * 1024 * 1024) throw new engine.AppError('too_large', 413);
      const rows = await parseSpreadsheetToRows(file);
      return NextResponse.json(engine.mutate(conn, user, 'import', { rows }));
    }

    if (kind === 'import-preview') {
      if (user.role !== 'monitor') throw new engine.AppError('forbidden', 403);
      const ct = req.headers.get('content-type') || '';
      let rows: any[] = [];
      if (ct.includes('multipart/form-data')) {
        const form = await req.formData();
        const file = form.get('file') as File;
        if (!file || file.size > 5 * 1024 * 1024) throw new engine.AppError('too_large', 413);
        rows = await parseSpreadsheetToRows(file);
      } else {
        const body = await req.json();
        rows = body.rows || [];
      }
      return NextResponse.json({ items: engine.previewImport(conn, rows) });
    }

    if (kind === 'ai') {
      const body = await req.json();
      if (sub === 'config') {
        return NextResponse.json(engine.saveAiConfig(conn, user, body));
      }
      if (sub === 'test') {
        const cfg = engine.getAiConfig(conn);
        if (!cfg.configured) throw new engine.AppError('ai_not_configured', 400);
        const start = Date.now();
        const reply = await ai.callAiText(cfg, [
          { role: 'user', content: 'Say "OK" in one word.' },
        ], { maxTokens: 40 });
        return NextResponse.json({ ok: true, model: cfg.model, provider: cfg.provider, latencyMs: Date.now() - start, reply });
      }
      if (sub === 'ocr') {
        if (!['monitor', 'analyst'].includes(user.role)) throw new engine.AppError('forbidden', 403);
        const products = conn.prepare('SELECT * FROM products').all();
        const result = await ai.extractPriceTag({
          db: conn,
          imageBase64: body.imageBase64,
          mime: body.mime,
          rawText: body.rawText,
          products,
          lang: body.lang || 'kk',
        });
        engine.audit(conn, user, 'ai', result.productId || 'ocr', 'ai_ocr', {
          mode: result.mode,
          model: result.model,
          confidence: result.confidence,
        });
        return NextResponse.json(result);
      }
      if (sub === 'explain') {
        const snap = engine.snapshot(conn, user);
        const priceRow = snap.prices.find((p: any) => p.id === body.id);
        if (!priceRow) throw new engine.AppError('not_found', 404);
        const peers = engine.marketPeers(conn, priceRow.product_id, priceRow.store_id, priceRow.collected_at);
        const historyRows = snap.prices.filter(
          (p: any) => p.product_id === priceRow.product_id && p.store_id === priceRow.store_id && p.status !== 'rejected'
        );
        const result = await ai.explainAnomaly({
          db: conn,
          priceRow,
          peerPrices: peers,
          historyRows,
          lang: body.lang || 'kk',
        });
        engine.audit(conn, user, 'price', priceRow.id, 'ai_explain', {
          mode: result.mode,
          model: result.model,
          riskLevel: result.riskLevel,
        });
        return NextResponse.json(result);
      }
      if (sub === 'parse-rows') {
        if (user.role !== 'monitor') throw new engine.AppError('forbidden', 403);
        const products = conn.prepare('SELECT * FROM products').all();
        const parsed = await ai.parseMessyRows({
          db: conn,
          rawText: body.rawText,
          storeId: body.storeId || 'store-0',
          products,
          lang: body.lang || 'kk',
        });
        const items = parsed.rows.length ? engine.previewImport(conn, parsed.rows) : [];
        return NextResponse.json({ mode: parsed.mode, model: parsed.model, items });
      }
      if (sub === 'brief') {
        const result = await ai.generateExecutiveBrief({
          db: conn,
          summaryContext: body.summaryContext || {},
          lang: body.lang || 'kk',
        });
        return NextResponse.json(result);
      }
      if (sub === 'ask') {
        const result = await ai.askCopilot({
          db: conn,
          question: String(body.question || '').slice(0, 1000),
          summaryContext: body.summaryContext || {},
          lang: body.lang || 'kk',
        });
        return NextResponse.json(result);
      }
      throw new engine.AppError('not_found', 404);
    }

    return NextResponse.json(engine.mutate(conn, user, kind, await req.json()));
  } catch (e) {
    return failure(e);
  }
}
