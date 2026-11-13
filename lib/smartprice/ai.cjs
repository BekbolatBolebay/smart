const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const engine = require('./engine.cjs');

function stripThinking(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

function extractJson(text) {
  const cleaned = stripThinking(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.search(/[\[{]/);
  if (start === -1) throw new Error('no_json_in_response');
  const open = cleaned[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        return JSON.parse(cleaned.slice(start, i + 1));
      }
    }
  }
  return JSON.parse(cleaned.slice(start));
}

function isVisionCapable(model, provider) {
  if (provider === 'gemini') return true;
  return /vl|vision|gpt-4o|gpt-4\.1|claude-3|gemini|pixtral|llava/i.test(String(model || ''));
}

async function callOpenAiCompatible(cfg, messages, opts = {}) {
  const useModel = opts.model || cfg.model;
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: useModel,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 900,
  };
  const isQwen3 = /qwen3/i.test(useModel) || cfg.baseUrl.includes('alem.ai');
  if (isQwen3 && opts.disableThinking !== false) {
    body.chat_template_kwargs = { enable_thinking: false };
  }

  let res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs || 25000),
  });

  if (!res.ok && body.chat_template_kwargs) {
    const errText = await res.text().catch(() => '');
    if (res.status === 400 && /chat_template_kwargs/i.test(errText)) {
      delete body.chat_template_kwargs;
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs || 25000),
      });
    } else {
      throw new Error(`ai_http_${res.status}: ${errText.slice(0, 200)}`);
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ai_http_${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('empty_ai_response');
  return stripThinking(content);
}

async function callGemini(cfg, messages, opts = {}) {
  const useModel = opts.model || cfg.model || 'gemini-2.5-flash';
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(useModel)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const systemMsgs = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (Array.isArray(m.content)) {
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: m.content.map((part) => {
            if (part.type === 'image_url' && part.image_url?.url) {
              const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
              if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
            }
            return { text: part.text || '' };
          }),
        };
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] };
    });

  const payload = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxTokens ?? 900,
    },
    ...(systemMsgs ? { systemInstruction: { parts: [{ text: systemMsgs }] } } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(opts.timeoutMs || 25000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gemini_http_${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim();
  if (!textOut) throw new Error('empty_gemini_response');
  return stripThinking(textOut);
}

async function callAiText(cfg, messages, opts = {}) {
  if (!cfg.configured) throw new Error('ai_not_configured');
  if (cfg.provider === 'gemini') return callGemini(cfg, messages, opts);
  return callOpenAiCompatible(cfg, messages, opts);
}

async function callAiJson(cfg, messages, opts = {}) {
  const raw = await callAiText(cfg, messages, opts);
  return extractJson(raw);
}

async function runTesseractOcr(imageBuffer) {
  const { createWorker } = require('tesseract.js');
  const bundledCache = path.join(process.cwd(), 'data', 'tessdata');
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const cachePath = isServerless ? path.join(os.tmpdir(), 'tessdata') : bundledCache;
  fs.mkdirSync(cachePath, { recursive: true });
  const hasKaz = fs.existsSync(path.join(cachePath, 'kaz.traineddata'));
  const langs = hasKaz ? ['kaz', 'rus', 'eng'] : ['rus', 'eng'];
  let worker;
  try {
    worker = await createWorker(langs, 1, {
      cachePath,
      logger: () => {},
    });
    const result = await worker.recognize(imageBuffer);
    return {
      text: String(result?.data?.text || '').trim(),
      confidence: Math.round(Number(result?.data?.confidence || 0)),
    };
  } catch (err) {
    return { text: '', confidence: 0, ocrError: String(err?.message || err) };
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}

function deterministicParsePriceText(rawText, products) {
  const text = String(rawText || '');
  const lower = text.toLowerCase();

  // Extract quantity + unit (e.g. 900 мл, 900 г, 0.9 л, 1 кг, 10 шт)
  let quantity = 1;
  let unit = 'kg';
  const qtyMatch = /(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|гр|г|g|кг|kg|шт|дана|pcs)/i.exec(text);
  if (qtyMatch) {
    const val = Number(qtyMatch[1].replace(',', '.'));
    const rawUnit = qtyMatch[2].toLowerCase();
    if (rawUnit === 'мл' || rawUnit === 'ml') {
      quantity = Math.round((val / 1000) * 1000) / 1000;
      unit = 'l';
    } else if (rawUnit === 'л' || rawUnit === 'l') {
      quantity = val;
      unit = 'l';
    } else if (rawUnit === 'г' || rawUnit === 'гр' || rawUnit === 'g') {
      quantity = Math.round((val / 1000) * 1000) / 1000;
      unit = 'kg';
    } else if (rawUnit === 'кг' || rawUnit === 'kg') {
      quantity = val;
      unit = 'kg';
    } else {
      quantity = val;
      unit = 'pcs';
    }
  }

  // Extract price: prioritize numbers near тг/kzt/₸/цена/баға, or standalone numbers not equal to quantity
  let amount = null;
  const priceMatch =
    /(?:цена|бағасы|баға|price|итого|тг|₸)?\s*[:=]?\s*(\d{2,6}(?:[.,]\d{1,2})?)\s*(?:тг|тенге|теңге|kzt|₸)/i.exec(text) ||
    /(?:цена|бағасы|баға|price)\s*[:=]?\s*(\d{2,6}(?:[.,]\d{1,2})?)/i.exec(text);
  if (priceMatch) {
    amount = Number(priceMatch[1].replace(',', '.'));
  } else {
    const nums = [...text.matchAll(/\b(\d{2,6})\b/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n >= 40 && n <= 100000 && n !== 900 && n !== 800 && n !== 500 && n !== 200);
    if (nums.length) amount = nums[nums.length - 1];
  }

  const keywordMap = [
    ['milk900', /молоко|сүт|milk|moiioko|mojioko/i, (q) => q && q < 0.95],
    ['milk', /молоко|сүт|milk|moiioko|mojioko/i, () => true],
    ['kefir', /кефир|айран|kefir/i, () => true],
    ['cream', /сметана|қаймақ|cream/i, () => true],
    ['flour', /мука|ұн|flour/i, () => true],
    ['sugar', /сахар|қант|sugar/i, () => true],
    ['rice', /рис|күріш|rice/i, () => true],
    ['buckwheat', /греч|қарақұмық|buckwheat/i, () => true],
    ['oil', /масло|майы|май|oil/i, () => true],
    ['potato', /картоф|картоп|potato/i, () => true],
    ['carrot', /морков|сәбіз|carrot/i, () => true],
    ['onion', /лук|пияз|onion/i, () => true],
    ['cabbage', /капуст|қырыққабат|cabbage/i, () => true],
    ['eggs', /яйц|жұмыртқа|egg/i, () => true],
    ['bread', /хлеб|нан|bread/i, () => true],
    ['salt', /соль|тұз|salt/i, () => true],
  ];

  let matched = null;
  for (const [id, regex, pred] of keywordMap) {
    if (regex.test(lower) && pred(quantity)) {
      matched = products.find((p) => p.id === id) || null;
      if (matched) break;
    }
  }

  const effectiveQty = matched ? matched.quantity : quantity;
  const effectiveUnit = matched ? matched.unit : unit;
  const normalizedPerUnit = amount && effectiveQty ? Math.round((amount / effectiveQty) * 100) / 100 : null;

  return {
    productId: matched?.id || '',
    detectedName: matched ? matched.name : text.split('\n')[0]?.slice(0, 60) || '',
    amount,
    quantity: effectiveQty,
    unit: effectiveUnit,
    normalizedPerUnit,
    confidence: matched && amount ? 72 : 45,
  };
}

async function extractPriceTag({ db, imageBase64, mime, rawText, products, lang = 'kk' }) {
  const cfg = engine.getAiConfig(db);
  let ocrText = String(rawText || '').trim();
  let ocrConfidence = null;
  let usedVision = false;

  const catalogLines = products
    .map((p) => `${p.id}: ${p.name} / ${p.name_kk} (${p.quantity} ${p.unit})`)
    .join('\n');

  if (imageBase64) {
    const bytes = Buffer.from(imageBase64, 'base64');
    if (cfg.configured && (cfg.visionModel || isVisionCapable(cfg.model, cfg.provider))) {
      try {
        const visionModel = cfg.visionModel || cfg.model;
        const promptText = `Extract price tag fields from this retail image and match the closest SKU from catalog.\nCatalog:\n${catalogLines}\nReturn ONLY valid JSON: {"productId":string,"detectedName":string,"amount":number,"quantity":number,"unit":"kg"|"l"|"pcs","rawText":string,"confidence":number,"notes":string}.`;
        const parsed = await callAiJson(
          cfg,
          [
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: `data:${mime || 'image/png'};base64,${imageBase64}` } },
              ],
            },
          ],
          { model: visionModel }
        );
        usedVision = true;
        const matched = products.find((p) => p.id === parsed.productId);
        const amount = Number(parsed.amount) || null;
        const qty = matched ? matched.quantity : Number(parsed.quantity) || 1;
        return {
          mode: 'live_ai_vision',
          model: visionModel,
          rawOcrText: parsed.rawText || '',
          ocrConfidence: parsed.confidence || 90,
          productId: matched?.id || '',
          detectedName: parsed.detectedName || matched?.name || '',
          amount,
          quantity: qty,
          unit: matched?.unit || parsed.unit || 'kg',
          normalizedPerUnit: amount ? Math.round((amount / qty) * 100) / 100 : null,
          confidence: Number(parsed.confidence) || 88,
          notes: parsed.notes || '',
        };
      } catch {
        // Fall through to Tesseract OCR + LLM
      }
    }

    const ocr = await runTesseractOcr(bytes);
    ocrText = ocr.text;
    ocrConfidence = ocr.confidence;
  }

  const fallback = deterministicParsePriceText(ocrText, products);
  if (!cfg.configured || !ocrText) {
    return {
      mode: 'local_ocr_parser',
      model: 'tesseract+regex',
      rawOcrText: ocrText,
      ocrConfidence,
      ...fallback,
      notes: '',
    };
  }

  try {
    const langName = lang === 'kk' ? 'Kazakh' : lang === 'en' ? 'English' : 'Russian';
    const parsed = await callAiJson(cfg, [
      {
        role: 'system',
        content: `You normalize OCR/raw retail price tags for Kazakhstan socially important food monitoring (ӘМАТ/СЗПТ). Fix OCR homoglyphs (e.g. MOJIOKO -> Молоко 2.5%, 900мл -> 0.9 l). Keep package sizes distinct (milk 1 l vs milk900 0.9 l). Return ONLY valid JSON with keys: productId (one of catalog IDs or ""), detectedName (string), amount (number in KZT), quantity (number in base unit kg/l/pcs), unit ("kg"|"l"|"pcs"), confidence (0-100), notes (1 short sentence in ${langName}).`,
      },
      {
        role: 'user',
        content: `Catalog:\n${catalogLines}\n\nOCR / Raw text:\n${ocrText}`,
      },
    ]);

    const matched = products.find((p) => p.id === parsed.productId) || products.find((p) => p.id === fallback.productId);
    const amount = Number(parsed.amount) > 0 ? Number(parsed.amount) : fallback.amount;
    const qty = matched ? matched.quantity : Number(parsed.quantity) > 0 ? Number(parsed.quantity) : fallback.quantity;
    const unit = matched ? matched.unit : ['kg', 'l', 'pcs'].includes(parsed.unit) ? parsed.unit : fallback.unit;

    return {
      mode: imageBase64 ? 'live_ocr_plus_ai' : 'live_ai',
      model: usedVision ? cfg.visionModel || cfg.model : `${imageBase64 ? 'tesseract+' : ''}${cfg.model}`,
      rawOcrText: ocrText,
      ocrConfidence,
      productId: matched?.id || '',
      detectedName: parsed.detectedName || fallback.detectedName,
      amount,
      quantity: qty,
      unit,
      normalizedPerUnit: amount && qty ? Math.round((amount / qty) * 100) / 100 : null,
      confidence: Math.min(99, Math.max(10, Number(parsed.confidence) || fallback.confidence)),
      notes: String(parsed.notes || ''),
    };
  } catch {
    return {
      mode: 'local_ocr_parser',
      model: 'tesseract+regex',
      rawOcrText: ocrText,
      ocrConfidence,
      ...fallback,
      notes: '',
    };
  }
}

function buildFallbackExplanation(ctx, lang) {
  const { productName, storeName, amount, previous, delta, marketMedian, zScore, unit, normalized } = ctx;
  const riskLevel = Math.abs(delta) >= 25 || (zScore !== null && Math.abs(zScore) >= 4) ? 'high' : 'medium';
  if (lang === 'kk') {
    return {
      mode: 'local_statistical',
      model: 'MAD-ZScore + RuleEngine',
      riskLevel,
      summary: `${productName} (${storeName}) бағасы ${amount} ₸ (${normalized} ₸/${unit}). Өзгеріс: ${delta >= 0 ? '+' : ''}${delta}%${marketMedian ? `, нарық медианасы: ${marketMedian} ₸` : ''}${zScore !== null ? `, MAD Z-Score: ${zScore}` : ''}.`,
      hypotheses: [
        'Қаптама көлемі мен бірлік бағасының (кг/л) сәйкестігін тексеру қажет.',
        'Өңірлік жеткізу немесе көтерме баға өзгерісін салыстыру.',
        'Қолмен енгізу немесе кассалық чек қателігін жоққа шығару.',
      ],
      checklist: [
        'Сауда нүктесіндегі сөре бағасының фотосын салыстыру.',
        'Сол қаладағы кемінде 2 көрші дүкендегі бағамен тексеру.',
      ],
      draftConclusion: `Талдау тексерісі: ${productName} бағасы (${amount} ₸, ${delta >= 0 ? '+' : ''}${delta}%) статистикалық шектен асты. Бұл заң бұзушылық дәлелі емес; қайта тексеру және фото-растау талап етіледі.`,
    };
  }
  if (lang === 'en') {
    return {
      mode: 'local_statistical',
      model: 'MAD-ZScore + RuleEngine',
      riskLevel,
      summary: `${productName} at ${storeName} is ${amount} ₸ (${normalized} ₸/${unit}), change ${delta >= 0 ? '+' : ''}${delta}%${marketMedian ? `, peer median ${marketMedian} ₸` : ''}${zScore !== null ? `, MAD Z-Score ${zScore}` : ''}.`,
      hypotheses: [
        'Verify package size vs unit price to rule out SKU mismatch.',
        'Check wholesale or logistics cost shift in the local region.',
        'Rule out manual data entry typo against shelf label photo.',
      ],
      checklist: [
        'Verify shelf price label photo evidence.',
        'Compare against at least 2 nearby retail locations.',
      ],
      draftConclusion: `Analyst note: ${productName} observation (${amount} ₸, ${delta >= 0 ? '+' : ''}${delta}%) exceeded threshold. Signal requires field verification and is not a legal violation finding.`,
    };
  }
  return {
    mode: 'local_statistical',
    model: 'MAD-ZScore + RuleEngine',
    riskLevel,
    summary: `${productName} (${storeName}): цена ${amount} ₸ (${normalized} ₸/${unit}), изменение ${delta >= 0 ? '+' : ''}${delta}%${marketMedian ? `, медиана рынка ${marketMedian} ₸` : ''}${zScore !== null ? `, MAD Z-Score: ${zScore}` : ''}.`,
    hypotheses: [
      'Проверить соответствие объёма упаковки и цены за базовую единицу.',
      'Сверить возможное изменение оптовой закупки или логистики.',
      'Исключить ошибку ручного ввода по фото ценника.',
    ],
    checklist: [
      'Сверить фото ценника/чека в карточке доказательств.',
      'Сопоставить с минимум 2 соседними торговыми точками региона.',
    ],
    draftConclusion: `Заключение проверки: отклонение по ${productName} (${amount} ₸, ${delta >= 0 ? '+' : ''}${delta}%) превышает статистический порог. Сигнал является основанием для проверки, а не выводом о нарушении.`,
  };
}

async function explainAnomaly({ db, priceRow, peerPrices, historyRows, lang = 'kk' }) {
  const cfg = engine.getAiConfig(db);
  const analysis = engine.analyze(priceRow.amount, priceRow.previous, peerPrices);
  const sortedPeers = [...peerPrices].filter((x) => x > 0).sort((a, b) => a - b);
  const marketMin = sortedPeers.length ? sortedPeers[0] : null;
  const marketMax = sortedPeers.length ? sortedPeers[sortedPeers.length - 1] : null;
  const pName = lang === 'kk' ? priceRow.name_kk : lang === 'en' ? priceRow.name_en : priceRow.name;

  const stats = {
    previous: priceRow.previous,
    current: priceRow.amount,
    delta: priceRow.delta,
    normalized: priceRow.normalized,
    unit: priceRow.unit,
    quantity: priceRow.quantity,
    marketMin,
    marketMedian: analysis.median,
    marketMax,
    peerCount: sortedPeers.length,
    zScore: analysis.zScore,
    reason: analysis.reason || priceRow.reason || 'manual',
  };

  const ctx = {
    productName: pName,
    storeName: priceRow.store_name,
    region: priceRow.region,
    amount: priceRow.amount,
    previous: priceRow.previous,
    delta: priceRow.delta,
    marketMedian: analysis.median,
    zScore: analysis.zScore,
    unit: priceRow.unit,
    normalized: priceRow.normalized,
  };

  if (!cfg.configured) {
    const fb = buildFallbackExplanation(ctx, lang);
    return { ...fb, stats };
  }

  const langLabel = lang === 'kk' ? 'Kazakh (Қазақша)' : lang === 'en' ? 'English' : 'Russian';
  const recentTrend = historyRows
    .slice(0, 10)
    .reverse()
    .map((h) => `${h.collected_at.slice(0, 10)}:${h.amount}`)
    .join(', ');

  try {
    const parsed = await callAiJson(cfg, [
      {
        role: 'system',
        content: `You are a GovTech food price monitoring analyst assistant in Kazakhstan (ӘМАТ/СЗПТ Case 03).
CRITICAL POLICY: Never accuse a store of illegal price gouging or declare a legal violation. Anomalies are strictly statistical signals for verification.
Respond ONLY in ${langLabel} inside valid JSON with keys:
{"summary":string,"riskLevel":"low"|"medium"|"high","hypotheses":[string,string],"checklist":[string,string],"draftConclusion":string}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          product: pName,
          package: `${priceRow.quantity} ${priceRow.unit}`,
          store: priceRow.store_name,
          region: priceRow.region,
          stats,
          recent10Days: recentTrend,
        }),
      },
    ]);

    const result = {
      mode: 'live_ai',
      model: cfg.model,
      riskLevel: ['low', 'medium', 'high'].includes(parsed.riskLevel) ? parsed.riskLevel : 'medium',
      summary: String(parsed.summary || ''),
      hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses.slice(0, 4).map(String) : [],
      checklist: Array.isArray(parsed.checklist) ? parsed.checklist.slice(0, 4).map(String) : [],
      draftConclusion: String(parsed.draftConclusion || ''),
      stats,
    };
    engine.saveAiAnalysis(db, priceRow.id, result.mode, result.model, lang, result);
    return result;
  } catch {
    const fb = buildFallbackExplanation(ctx, lang);
    return { ...fb, stats };
  }
}

async function parseMessyRows({ db, rawText, storeId, products, lang = 'kk' }) {
  const cfg = engine.getAiConfig(db);
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 40);

  if (!lines.length) return { mode: 'local_parser', model: 'regex', rows: [] };
  const nowIso = new Date(Date.now() - 1000).toISOString();

  if (cfg.configured) {
    try {
      const catalog = products.map((p) => `${p.id}: ${p.name} / ${p.name_kk} (${p.quantity} ${p.unit})`).join('\n');
      const parsed = await callAiJson(cfg, [
        {
          role: 'system',
          content: `Parse each messy retail price line into a structured JSON array. Match each line to the closest product_id in Catalog. Use store_id="${storeId}" and collected_at="${nowIso}". Return ONLY a valid JSON array of objects: [{"product_id":string,"store_id":string,"amount":number,"collected_at":string,"source":"ai-import","raw_line":string}].`,
        },
        {
          role: 'user',
          content: `Catalog:\n${catalog}\n\nLines:\n${lines.join('\n')}`,
        },
      ]);
      if (Array.isArray(parsed) && parsed.length) {
        return {
          mode: 'live_ai',
          model: cfg.model,
          rows: parsed.map((r) => ({
            product_id: String(r.product_id || ''),
            store_id: String(r.store_id || storeId),
            amount: Number(r.amount),
            collected_at: r.collected_at || nowIso,
            source: 'ai-import',
            raw_line: String(r.raw_line || ''),
          })),
        };
      }
    } catch {
      // Fallback below
    }
  }

  const rows = lines.map((line) => {
    const p = deterministicParsePriceText(line, products);
    return {
      product_id: p.productId,
      store_id: storeId,
      amount: p.amount || 0,
      collected_at: nowIso,
      source: 'ai-import',
      raw_line: line,
    };
  });

  return { mode: 'local_parser', model: 'regex', rows };
}

async function generateExecutiveBrief({ db, summaryContext, lang = 'kk' }) {
  const cfg = engine.getAiConfig(db);
  if (!cfg.configured) {
    return {
      mode: 'local_statistical',
      model: 'RuleSummary',
      brief:
        lang === 'kk'
          ? `Қамту: ${summaryContext.totalPrices} бақылау, ${summaryContext.pendingCount} ауытқу тексеруді күтуде. Азық-түлік себеті: ${summaryContext.basketCurrent} ₸ (7 күндік Holt болжамы: ${summaryContext.basketForecast7d ?? '—'} ₸).`
          : lang === 'en'
          ? `Coverage: ${summaryContext.totalPrices} observations, ${summaryContext.pendingCount} pending reviews. Food basket: ${summaryContext.basketCurrent} ₸ (7-day Holt forecast: ${summaryContext.basketForecast7d ?? '—'} ₸).`
          : `Охват: ${summaryContext.totalPrices} наблюдений, ${summaryContext.pendingCount} аномалий на проверке. Корзина: ${summaryContext.basketCurrent} ₸ (7-дневный прогноз Holt: ${summaryContext.basketForecast7d ?? '—'} ₸).`,
    };
  }

  const langLabel = lang === 'kk' ? 'Kazakh (Қазақша)' : lang === 'en' ? 'English' : 'Russian';
  const textOut = await callAiText(cfg, [
    {
      role: 'system',
      content: `You are an executive analyst for Kazakhstan's ӘМАТ/СЗПТ food price monitoring platform SMART PRICE. Write a concise, bulleted executive brief (4-5 short bullet points) in ${langLabel} strictly citing ONLY the figures provided in the JSON context. Never declare legal violations; frame anomalies as verification targets.`,
    },
    {
      role: 'user',
      content: JSON.stringify(summaryContext),
    },
  ]);

  return { mode: 'live_ai', model: cfg.model, brief: textOut };
}

async function askCopilot({ db, question, summaryContext, lang = 'kk' }) {
  const cfg = engine.getAiConfig(db);
  if (!cfg.configured) {
    throw new Error('ai_not_configured');
  }
  const langLabel = lang === 'kk' ? 'Kazakh (Қазақша)' : lang === 'en' ? 'English' : 'Russian';
  const answer = await callAiText(cfg, [
    {
      role: 'system',
      content: `You are SMART PRICE AI Copilot for Kazakhstan ӘМАТ/СЗПТ monitoring. Answer concisely in the user's language (default ${langLabel}) using ONLY the factual numbers in the provided database snapshot summary. If something is not in the data, say so clearly. Remember: anomalies are signals for verification, not automatic legal violations.`,
    },
    {
      role: 'user',
      content: `Live database context:\n${JSON.stringify(summaryContext)}\n\nQuestion: ${question}`,
    },
  ]);
  return { mode: 'live_ai', model: cfg.model, answer };
}

module.exports = {
  callAiText,
  callAiJson,
  extractPriceTag,
  explainAnomaly,
  parseMessyRows,
  generateExecutiveBrief,
  askCopilot,
  deterministicParsePriceText,
  stripThinking,
  extractJson,
};

