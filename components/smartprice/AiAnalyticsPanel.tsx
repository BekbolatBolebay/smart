'use client';
import React, { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  BrainCircuit,
  Sparkles,
  Send,
  Scale,
  Calculator,
  TrendingUp,
  ArrowRight,
  Loader2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Lang, tr, productName, regionName, errorText } from '@/lib/smartprice/i18n';
import {
  computeRegionalProductStats,
  computeProductSummaryTable,
  computePeriodComparison,
  detectShrinkflation,
} from '@/lib/smartprice/metrics';
import { formatCurrency } from '@/lib/utils';

const money = (n: number) => formatCurrency(Math.round(n || 0));

export function buildSummaryContext(data: any, scoped: any[], latest: any[], series: any[], forecast: any, lang: Lang) {
  const regional = computeRegionalProductStats(latest, data.regions || [], '');
  const sortedRisers = [...latest].filter((p) => p.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const sortedFallers = [...latest].filter((p) => p.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  const pending = latest.filter((p) => p.status === 'pending').slice(0, 6);
  const basketCurrent = [...series].reverse().find((s) => s.value !== null)?.value ?? null;
  const shrink = detectShrinkflation(data.products || [], latest);

  return {
    language: lang,
    totalProducts: data.products?.length || 0,
    totalStores: data.stores?.length || 0,
    totalObservations: scoped.length,
    pendingAlertsCount: latest.filter((p) => p.status === 'pending').length,
    basketCurrentKzt: basketCurrent,
    basketForecast7dKzt: forecast?.summary?.forecastEnd ?? null,
    basketForecastChangePct: forecast?.summary?.changePct ?? null,
    topRisers: sortedRisers.map((p) => ({
      product: productName(p, lang),
      store: p.store_name,
      region: p.region,
      price: p.amount,
      normalized: p.normalized,
      unit: p.unit,
      deltaPct: p.delta,
    })),
    topFallers: sortedFallers.map((p) => ({
      product: productName(p, lang),
      store: p.store_name,
      price: p.amount,
      deltaPct: p.delta,
    })),
    pendingAlerts: pending.map((p) => ({
      product: productName(p, lang),
      store: p.store_name,
      region: p.region,
      amount: p.amount,
      previous: p.previous,
      deltaPct: p.delta,
      reason: p.reason,
    })),
    shrinkflationPairs: shrink.pairs.map((sp: any) => ({
      family: sp.family,
      smallSize: `${sp.small.quantity} ${sp.unit}`,
      smallUnitAvg: sp.smallUnitAvg,
      largeSize: `${sp.large.quantity} ${sp.unit}`,
      largeUnitAvg: sp.largeUnitAvg,
      hiddenMarkupPct: sp.hiddenPremiumPct,
    })),
    regionsCovered: regional.length,
  };
}

export default function AiAnalyticsPanel({
  data,
  scoped,
  latest,
  series,
  forecast,
  product,
  setProduct,
  lang,
  onSelectRegion,
  api,
}: {
  data: any;
  scoped: any[];
  latest: any[];
  series: any[];
  forecast: any;
  product: string;
  setProduct: (id: string) => void;
  lang: Lang;
  onSelectRegion: (id: string) => void;
  api: (path: string, body?: any) => Promise<any>;
}) {
  const t = (k: string) => tr(k, lang);
  const pn = (p: any) => productName(p, lang);
  const compareProductId = product || data.products?.[0]?.id || 'oil';
  const selectedProd = data.products?.find((p: any) => p.id === compareProductId);

  const regionalProductStats = useMemo(
    () => computeRegionalProductStats(latest, data.regions || [], compareProductId),
    [latest, data.regions, compareProductId]
  );

  const productSummaryRows = useMemo(
    () => computeProductSummaryTable(latest, data.products || []),
    [latest, data.products]
  );

  const periodComparison = useMemo(
    () => computePeriodComparison(scoped, compareProductId),
    [scoped, compareProductId]
  );

  const shrinkflation = useMemo(
    () => detectShrinkflation(data.products || [], latest),
    [data.products, latest]
  );

  // Interactive Case 03 calculator state (900 g / 450 KZT = 500 KZT/kg)
  const [calcPrice, setCalcPrice] = useState('450');
  const [calcQty, setCalcQty] = useState('900');
  const [calcUnit, setCalcUnit] = useState<'g' | 'ml' | 'kg' | 'l' | 'pcs'>('g');
  const calcNormalized = useMemo(() => {
    const p = Number(calcPrice);
    const q = Number(calcQty);
    if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) return null;
    const baseQty = calcUnit === 'g' || calcUnit === 'ml' ? q / 1000 : q;
    return Math.round((p / baseQty) * 100) / 100;
  }, [calcPrice, calcQty, calcUnit]);

  // AI Brief & Copilot state
  const [briefLoading, setBriefLoading] = useState(false);
  const [brief, setBrief] = useState<{ mode: string; model: string; brief: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [qaList, setQaList] = useState<Array<{ q: string; a: string; model: string }>>([]);

  const chartData = useMemo(
    () =>
      regionalProductStats.map((row: any) => ({
        region: regionName(row.region, lang).replace(/ облысы| область| Region/g, ''),
        regionId: row.region.id,
        min: Math.round(row.min),
        median: Math.round(row.median),
        max: Math.round(row.max),
      })),
    [regionalProductStats, lang]
  );

  async function handleBrief() {
    setBriefLoading(true);
    try {
      const summaryContext = buildSummaryContext(data, scoped, latest, series, forecast, lang);
      const res = await api('ai/brief', { summaryContext, lang });
      setBrief(res);
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    } finally {
      setBriefLoading(false);
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAskLoading(true);
    try {
      const q = question.trim();
      const summaryContext = buildSummaryContext(data, scoped, latest, series, forecast, lang);
      const res = await api('ai/ask', { question: q, summaryContext, lang });
      setQaList((prev) => [{ q, a: res.answer, model: res.model }, ...prev]);
      setQuestion('');
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    } finally {
      setAskLoading(false);
    }
  }

  const quickPrompts =
    lang === 'kk'
      ? [
          'Қай өңірде күнбағыс майы ең қымбат және ең арзан?',
          '900 мл және 1 л сүт бағасының айырмашылығы қандай?',
          'Қандай өнімдерде шұғыл тексеруді қажет ететін ауытқу бар?',
        ]
      : lang === 'en'
      ? [
          'Which region has the highest and lowest sunflower oil price?',
          'Compare 900 ml vs 1 L milk unit prices',
          'Which observations require urgent analyst verification?',
        ]
      : [
          'В каком регионе подсолнечное масло самое дорогое и самое дешёвое?',
          'Сравни цену за литр молока 900 мл и 1 л',
          'Какие наблюдения требуют срочной проверки аналитиком?',
        ];

  return (
    <>
      {/* AI Brief + Copilot Row */}
      <div className="sp-two-col">
        <section className="sp-card sp-ai-card">
          <div className="sp-card-head">
            <div>
              <h3>
                <Sparkles size={16} />
                {t('aiBrief')}
              </h3>
              <p>
                {data.ai?.configured ? `${t('aiLive')}: ${data.ai.model}` : t('aiLocal')} · Case 03
              </p>
            </div>
            <button className="sp-btn primary" disabled={briefLoading} onClick={handleBrief}>
              {briefLoading ? <Loader2 size={14} className="spin" /> : <BrainCircuit size={14} />}
              {t('generateBrief')}
            </button>
          </div>
          <div className="sp-ai-body">
            {brief ? (
              <div className="sp-ai-output">
                <div className="sp-ai-meta">
                  <span className="sp-chip">{brief.model}</span>
                  <span>{brief.mode === 'live_ai' ? t('aiLive') : t('aiLocal')}</span>
                </div>
                <pre className="sp-ai-pre">{brief.brief}</pre>
              </div>
            ) : (
              <p className="sp-section-note" style={{ padding: 0, margin: 0 }}>
                {t('methodText')}
              </p>
            )}
          </div>
        </section>

        <section className="sp-card sp-ai-card">
          <div className="sp-card-head">
            <div>
              <h3>
                <BrainCircuit size={16} />
                {t('aiCopilot')}
              </h3>
              <p>{data.ai?.configured ? `${data.ai.baseUrl} · ${data.ai.model}` : t('ai_not_configured')}</p>
            </div>
          </div>
          <div className="sp-ai-body">
            <div className="sp-quick-prompts">
              {quickPrompts.map((qp) => (
                <button key={qp} type="button" className="sp-pill-btn" onClick={() => setQuestion(qp)}>
                  {qp}
                </button>
              ))}
            </div>
            <form className="sp-copilot-form" onSubmit={handleAsk}>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t('askPlaceholder')}
                maxLength={500}
              />
              <button type="submit" className="sp-btn primary" disabled={askLoading || !question.trim()}>
                {askLoading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                {t('askBtn')}
              </button>
            </form>
            {qaList.length > 0 && (
              <div className="sp-qa-list">
                {qaList.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="sp-qa-item">
                    <strong>{item.q}</strong>
                    <p>{item.a}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Min / Median / Max Regional & Period Comparison (Case 03 Function 4) */}
      <section className="sp-card">
        <div className="sp-card-head">
          <div>
            <h3>
              <Scale size={16} />
              {t('regionStats')} — {pn(selectedProd)} ({selectedProd?.quantity} {t(selectedProd?.unit)})
            </h3>
            <p>{t('notComparable')}</p>
          </div>
          <select
            aria-label={t('product')}
            value={compareProductId}
            onChange={(e) => setProduct(e.target.value)}
          >
            {data.products.map((p: any) => (
              <option key={p.id} value={p.id}>
                {pn(p)} · {p.quantity} {t(p.unit)}
              </option>
            ))}
          </select>
        </div>

        {periodComparison && (
          <div className="sp-period-strip">
            <div>
              <small>{t('periodCompare')}</small>
              <strong>
                {periodComparison.earlyFrom} → {periodComparison.earlyTo}: {money(periodComparison.early.median)} / {t(selectedProd?.unit)}
              </strong>
            </div>
            <ArrowRight size={16} />
            <div>
              <small>
                {periodComparison.lateFrom} → {periodComparison.lateTo}
              </small>
              <strong>
                {money(periodComparison.late.median)} / {t(selectedProd?.unit)} (
                {periodComparison.medianDeltaPct > 0 ? '+' : ''}
                {periodComparison.medianDeltaPct}%)
              </strong>
            </div>
            <div>
              <small>Min / Max ({t('period')})</small>
              <strong>
                {money(periodComparison.late.min)} – {money(periodComparison.late.max)}
              </strong>
            </div>
          </div>
        )}

        <div className="sp-chart" style={{ height: 270, padding: '10px 20px 15px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 20 }}>
              <CartesianGrid vertical={false} stroke="#eaf0f4" strokeDasharray="3 4" />
              <XAxis
                dataKey="region"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6c7e91', fontSize: 10 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={55}
              />
              <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: '#8492a4', fontSize: 10 }} />
              <Tooltip
                formatter={(val: number, name: string) => [money(val), name]}
                contentStyle={{ borderRadius: 10, border: '1px solid #e5ebf0', fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="min" name={t('minPrice')} fill="#209b85" radius={[3, 3, 0, 0]} />
              <Bar dataKey="median" name={t('medianPrice')} fill="#193a56" radius={[3, 3, 0, 0]} />
              <Bar dataKey="max" name={t('maxPrice')} fill="#df6c67" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{t('region')}</th>
                <th>{t('totalStores')}</th>
                <th>{t('minPrice')}</th>
                <th>{t('medianPrice')}</th>
                <th>{t('maxPrice')}</th>
                <th>{t('spreadPct')}</th>
              </tr>
            </thead>
            <tbody>
              {regionalProductStats.map((row: any) => (
                <tr key={row.region.id} onClick={() => onSelectRegion(row.region.id)}>
                  <td>
                    <strong>{regionName(row.region, lang)}</strong>
                  </td>
                  <td>{row.stores}</td>
                  <td style={{ color: '#209b85', fontWeight: 600 }}>
                    {money(row.min)} / {t(selectedProd?.unit)}
                    <small>{row.minItem?.store_name}</small>
                  </td>
                  <td className="sp-price">
                    {money(row.median)} / {t(selectedProd?.unit)}
                  </td>
                  <td style={{ color: '#c76d66', fontWeight: 600 }}>
                    {money(row.max)} / {t(selectedProd?.unit)}
                    <small>{row.maxItem?.store_name}</small>
                  </td>
                  <td>{row.spreadPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Shrinkflation Radar & Case 03 Calculator */}
      <div className="sp-two-col">
        <section className="sp-card">
          <div className="sp-card-head">
            <div>
              <h3>
                <AlertTriangle size={16} />
                {t('shrinkflationTitle')}
              </h3>
              <p>{t('shrinkflationNote')}</p>
            </div>
          </div>
          <div className="sp-shrink-list">
            {shrinkflation.pairs.map((sp: any) => (
              <div className="sp-shrink-item" key={sp.family}>
                <div>
                  <strong>
                    {pn(sp.small)} ({sp.small.quantity} {t(sp.unit)} ↔ {sp.large.quantity} {t(sp.unit)})
                  </strong>
                  <small>
                    {sp.small.quantity} {t(sp.unit)}: {money(sp.smallShelfAvg)} → {money(sp.smallUnitAvg)} / {t(sp.unit)} ·{' '}
                    {sp.large.quantity} {t(sp.unit)}: {money(sp.largeShelfAvg)} → {money(sp.largeUnitAvg)} / {t(sp.unit)}
                  </small>
                </div>
                <span className={'sp-delta ' + (sp.hiddenPremiumPct > 0 ? 'up' : 'down')}>
                  {sp.hiddenPremiumPct > 0 ? '+' : ''}
                  {sp.hiddenPremiumPct}%
                </span>
              </div>
            ))}
            {shrinkflation.nonUnitPackages.map((np: any) => (
              <div className="sp-shrink-item" key={np.product.id}>
                <div>
                  <strong>
                    {pn(np.product)} ({np.product.quantity} {t(np.product.unit)})
                  </strong>
                  <small>
                    {money(np.shelfAvg)} ({np.product.quantity} {t(np.product.unit)}) ={' '}
                    <b>
                      {money(np.unitAvg)} / {t(np.product.unit)}
                    </b>
                  </small>
                </div>
                <span className="sp-chip">
                  {Math.round((1 / np.product.quantity) * 100) / 100}×
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="sp-card">
          <div className="sp-card-head">
            <div>
              <h3>
                <Calculator size={16} />
                {t('unitCalcTitle')}
              </h3>
              <p>900 г / 450 ₸ = 500 ₸ / кг · 900 мл / 450 ₸ = 500 ₸ / л</p>
            </div>
          </div>
          <div className="sp-calc-box">
            <div className="sp-calc-grid">
              <label>
                {t('shelfPrice')}
                <input
                  type="number"
                  min="1"
                  value={calcPrice}
                  onChange={(e) => setCalcPrice(e.target.value)}
                />
              </label>
              <label>
                {t('quantity')}
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={calcQty}
                  onChange={(e) => setCalcQty(e.target.value)}
                />
              </label>
              <label>
                {t('unit')}
                <select value={calcUnit} onChange={(e) => setCalcUnit(e.target.value as any)}>
                  <option value="g">г (грамм → кг)</option>
                  <option value="ml">мл (миллилитр → л)</option>
                  <option value="kg">кг</option>
                  <option value="l">л</option>
                  <option value="pcs">{t('pcs')}</option>
                </select>
              </label>
            </div>
            <div className="sp-calc-result">
              <span>{t('unitPrice')}</span>
              <strong>
                {calcNormalized != null ? `${money(calcNormalized)} / ${calcUnit === 'g' || calcUnit === 'kg' ? t('kg') : calcUnit === 'ml' || calcUnit === 'l' ? t('l') : t('pcs')}` : '—'}
              </strong>
            </div>
          </div>
        </section>
      </div>

      {/* Complete 16-Product Min / Median / Max Table */}
      <section className="sp-card">
        <div className="sp-card-head">
          <div>
            <h3>
              <TrendingUp size={16} />
              {t('allProductsSummary')}
            </h3>
          </div>
        </div>
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>{t('product')}</th>
                <th>{t('totalPrices')}</th>
                <th>{t('minPrice')}</th>
                <th>{t('medianPrice')}</th>
                <th>{t('maxPrice')}</th>
                <th>{t('spreadPct')}</th>
              </tr>
            </thead>
            <tbody>
              {productSummaryRows.map((row: any) => (
                <tr key={row.product.id} onClick={() => setProduct(row.product.id)}>
                  <td>
                    <strong>{pn(row.product)}</strong>
                    <small>
                      {row.product.quantity} {t(row.product.unit)}
                    </small>
                  </td>
                  <td>{row.count}</td>
                  <td style={{ color: '#209b85', fontWeight: 600 }}>
                    {money(row.min)} / {t(row.product.unit)}
                  </td>
                  <td className="sp-price">
                    {money(row.median)} / {t(row.product.unit)}
                  </td>
                  <td style={{ color: '#c76d66', fontWeight: 600 }}>
                    {money(row.max)} / {t(row.product.unit)}
                  </td>
                  <td>
                    <span className={'sp-stamp ' + (row.spreadPct > 30 ? 'pending' : 'verified')}>
                      <i />
                      {row.spreadPct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

