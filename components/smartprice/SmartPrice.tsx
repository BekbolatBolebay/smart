'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  LayoutDashboard,
  Map as MapIcon,
  Package,
  Store,
  Activity,
  BrainCircuit,
  ShieldCheck,
  History,
  FileBarChart,
  Users,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Upload,
  Play,
  Check,
  Menu,
  X,
  Bell,
  RefreshCw,
  MapPin,
  TrendingUp,
  ShoppingBasket,
  Globe,
  LogOut,
  ExternalLink,
  Camera,
  MessageSquare,
  Pencil,
  Trash2,
  Layers,
  Leaf,
  Database,
  Loader2,
  AlertTriangle,
  Sparkles,
  Scale,
} from 'lucide-react';
import { toast } from 'sonner';
import { Lang, tr, errorText, productName, regionName } from '@/lib/smartprice/i18n';
import {
  latestPrices,
  baskets,
  forecastSeries,
  computeMinMedianMax,
  computeRegionalProductStats,
} from '@/lib/smartprice/metrics';
import { formatCurrency } from '@/lib/utils';
import AiAnalyticsPanel from './AiAnalyticsPanel';
import SmartImportModal from './SmartImportModal';
import PriceTagScanner from './PriceTagScanner';
import './smartprice.css';

const KazakhstanMap = dynamic(() => import('./KazakhstanMap'), { ssr: false });

const nav = [
  ['dashboard', LayoutDashboard],
  ['map', MapIcon],
  ['products', Package],
  ['stores', Store],
  ['monitoring', Activity],
  ['analytics', BrainCircuit],
  ['verification', ShieldCheck],
  ['history', History],
  ['reports', FileBarChart],
  ['users', Users],
  ['settings', Settings],
] as const;

const money = (n: number) => formatCurrency(Math.round(n || 0));

function Stamp({ status, t }: any) {
  return (
    <span className={'sp-stamp ' + status}>
      <i />
      {t(status)}
    </span>
  );
}

function Delta({ value = 0 }: any) {
  return (
    <span className={'sp-delta ' + (value > 0 ? 'up' : value < 0 ? 'down' : 'neutral')}>
      {value > 0 ? <ArrowUpRight size={13} /> : value < 0 ? <ArrowDownRight size={13} /> : null}
      {(value > 0 ? '+' : '') + Number(value || 0).toFixed(2)}%
    </span>
  );
}

export default function SmartPrice() {
  const [lang, setLang] = useState<Lang>('kk');
  const [data, setData] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState('dashboard');
  const [region, setRegion] = useState('');
  const [product, setProduct] = useState('');
  const [store, setStore] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [days, setDays] = useState(28);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [details, setDetails] = useState<any>({ comments: [], evidence: [], aiAnalyses: [] });
  const [aiExplain, setAiExplain] = useState<any>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [demo, setDemo] = useState(0);
  const [demoId, setDemoId] = useState('');
  const [offset, setOffset] = useState(0);
  const [stamp, setStamp] = useState('');

  // AI settings state
  const [aiForm, setAiForm] = useState({
    provider: 'openai-compatible',
    baseUrl: 'https://llm.alem.ai/v1',
    model: 'qwen3-8',
    visionModel: '',
    apiKey: '',
  });
  const [aiTestMsg, setAiTestMsg] = useState('');

  const photoRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const t = (k: string) => tr(k, lang);
  const pn = (p: any) => productName(p, lang);
  const rn = (id: string) => regionName(data?.regions.find((r: any) => r.id === id), lang);
  const locale = lang === 'en' ? 'en-GB' : lang === 'kk' ? 'kk-KZ' : 'ru-RU';
  const date = (s: string, time = false) =>
    new Date(s).toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    });

  async function api(path: string, body?: any) {
    let r;
    try {
      r = await fetch(
        '/api/smartprice/' + path,
        body !== undefined
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : { cache: 'no-store' }
      );
    } catch {
      throw new Error('network');
    }
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || 'server_error');
    return result;
  }

  async function refresh() {
    try {
      const d = await api('data');
      setData(d);
      if (d.ai) {
        setAiForm((prev) => ({
          ...prev,
          provider: d.ai.provider || prev.provider,
          baseUrl: d.ai.baseUrl || prev.baseUrl,
          model: d.ai.model || prev.model,
          visionModel: d.ai.visionModel || '',
          apiKey: '',
        }));
      }
      setError('');
      setStamp(new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));
      return d;
    } catch (e: any) {
      if (e.message === 'unauthorized') setData(null);
      else setError(e.message);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem('smartprice-language');
    if (stored && ['ru', 'kk', 'en'].includes(stored)) setLang(stored as Lang);
    refresh();
  }, []);

  useEffect(() => {
    localStorage.setItem('smartprice-language', lang);
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    setOffset(0);
  }, [page, region, product, store, status, query, from, to]);

  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => refresh(), 60000);
    return () => clearInterval(timer);
  }, [data?.user?.id]);

  useEffect(() => {
    if (!(modal || detail)) return;
    const previous = document.activeElement as HTMLElement;
    const timer = setTimeout(
      () => dialogRef.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(),
      50
    );
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setModal(null);
        setDetail(null);
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const list = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,textarea,a[href]'
          )
        );
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [modal, detail]);

  async function login(id: string) {
    setBusy(true);
    try {
      await api('login', { user_id: id });
      await refresh();
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    } finally {
      setBusy(false);
    }
  }

  async function action(kind: string, body: any, close = true) {
    setBusy(true);
    try {
      const result = await api(kind, body);
      const d = await refresh();
      if (close) setModal(null);
      toast.success(t('saved'));
      return { result, data: d };
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function navigate(p: string) {
    setPage(p);
    setMobile(false);
    setQuery('');
    setProduct('');
    setStore('');
    setStatus('');
    setCategory('');
    setFrom('');
    setTo('');
  }

  const scoped = useMemo(
    () =>
      data?.prices.filter(
        (p: any) =>
          (!region || p.region === region) &&
          (!product || p.product_id === product) &&
          (!store || p.store_id === store) &&
          (!from || p.collected_at >= from) &&
          (!to || p.collected_at.slice(0, 10) <= to)
      ) || [],
    [data, region, product, store, from, to]
  );

  const latest = useMemo(() => latestPrices(scoped), [scoped]);
  const series = useMemo(() => baskets(scoped, data?.products || []).slice(-days), [scoped, data?.products, days]);
  const forecast = useMemo(() => forecastSeries(series, 7, 'value'), [series]);
  const basketValue = [...series].reverse().find((s) => s.value !== null)?.value;
  const alerts = latest.filter((p: any) => p.status === 'pending');

  const filtered = useMemo(() => {
    const q = query.toLocaleLowerCase();
    return (page === 'verification' ? scoped.filter((p: any) => p.status === 'pending') : scoped).filter(
      (p: any) =>
        (!status || p.status === status) &&
        (!q || [p.name, p.name_kk, p.name_en, p.store_name, p.city].join(' ').toLocaleLowerCase().includes(q))
    );
  }, [scoped, page, status, query]);

  const role = data?.user.role;
  const isMonitor = role === 'monitor';
  const isAnalyst = role === 'analyst';

  const nowInput = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  };

  function newPrice() {
    setModal({
      kind: 'prices',
      title: 'addPrice',
      values: {
        product_id: product || data.products[0].id,
        store_id: store || data.stores.find((s: any) => s.monitoring)?.id,
        amount: '',
        collected_at: nowInput(),
        source: 'manual',
      },
    });
  }

  function newStore(s?: any) {
    setModal({
      kind: 'stores',
      title: s ? 'edit' : 'addStore',
      values: s
        ? { ...s }
        : { name: '', type: 'supermarket', region: region || 'astana', city: '', address: '', lat: '', lng: '', monitoring: true },
    });
  }

  function newProduct(p?: any) {
    setModal({
      kind: 'products',
      title: p ? 'edit' : 'addProduct',
      values: p
        ? { ...p }
        : {
            name: '',
            name_kk: '',
            name_en: '',
            category: 'grocery',
            brand: '',
            manufacturer: '',
            quantity: 1,
            unit: 'kg',
            packaging: 'pack',
            barcode: '',
            fat: '',
            family: '',
          },
    });
  }

  async function openDetail(p: any) {
    setDetail(p);
    setDetails({ comments: [], evidence: [], aiAnalyses: [] });
    setAiExplain(null);
    setComment('');
    try {
      const det = await api('detail/' + p.id);
      setDetails(det);
      if (det.aiAnalyses?.length) {
        setAiExplain(det.aiAnalyses[0].payload);
      }
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    }
  }

  async function runAiExplain() {
    if (!detail) return;
    setAiBusy(true);
    try {
      const res = await api('ai/explain', { id: detail.id, lang });
      setAiExplain(res);
      toast.success(res.model);
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    } finally {
      setAiBusy(false);
    }
  }

  async function detailAction(kind: string, extra: any) {
    if (!comment.trim()) {
      toast.error(t('conclusion'));
      return;
    }
    const a = await action(kind, { id: detail.id, comment, ...extra }, false);
    if (a) {
      setComment('');
      setDetail(a.data.prices.find((p: any) => p.id === detail.id));
      setDetails(await api('detail/' + detail.id));
    }
  }

  async function uploadPhoto(file?: File) {
    if (!file || !detail) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('imageLimit'));
      return;
    }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(file);
      });
      const a = await action('evidence', { id: detail.id, mime: file.type, base64, comment }, false);
      if (a) {
        setDetails(await api('detail/' + detail.id));
        setComment('');
      }
    } catch {
      toast.error(t('invalid_image'));
    } finally {
      setBusy(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  }

  function exportUrl() {
    const params = new URLSearchParams({
      lang,
      ...(region ? { region } : {}),
      ...(product ? { product } : {}),
      ...(store ? { store } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return '/api/smartprice/export?' + params;
  }

  async function beginDemo() {
    setRegion('');
    setProduct('');
    setStore('');
    setFrom('');
    setTo('');
    await login('monitor');
    setDemo(1);
    setDemoId('');
    setPage('dashboard');
  }

  async function demoSubmit() {
    const prev = latestPrices(data.prices).find((p: any) => p.product_id === 'oil' && p.store_id === 'store-0');
    const a = await action('prices', {
      product_id: 'oil',
      store_id: 'store-0',
      amount: Math.round(((prev.amount * 1100) / 850) * 100) / 100,
      collected_at: new Date().toISOString(),
      source: 'demo',
    });
    if (a) {
      setDemoId(a.result.id);
      setDemo(2);
    }
  }

  async function demoNext() {
    if (demo === 2) {
      await login('analyst');
      setPage('verification');
      setDemo(3);
    } else if (demo === 3) {
      const p = data.prices.find((x: any) => x.id === demoId);
      if (!['verified', 'rejected'].includes(p?.status)) {
        await openDetail(p);
        return;
      }
      await login('manager');
      setDetail(null);
      setPage('analytics');
      setDemo(4);
    } else setDemo(0);
  }

  const detailMarketStats = useMemo(() => {
    if (!detail || !data) return null;
    const peers = latestPrices(data.prices).filter(
      (p: any) => p.product_id === detail.product_id && p.store_id !== detail.store_id
    );
    return computeMinMedianMax(peers, 'amount');
  }, [detail, data]);

  function priceTable(list: any[], limited = false) {
    const items = limited ? list.slice(0, 5) : list.slice(offset, offset + 20);
    return (
      <>
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                {['product', 'store', 'current', 'previous', 'delta', 'status', ...(!limited ? ['collected', 'source'] : [])].map(
                  (k) => (
                    <th key={k}>{t(k)}</th>
                  )
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((p: any) => (
                <tr key={p.id} onClick={() => openDetail(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openDetail(p)}>
                  <td>
                    <span className={'sp-product-icon ' + p.category}>
                      {p.category === 'dairy' ? (
                        <Layers size={18} />
                      ) : p.category === 'vegetables' ? (
                        <Leaf size={18} />
                      ) : (
                        <Package size={18} />
                      )}
                    </span>
                    <span className="sp-cell-title">
                      {pn(p)}
                      <small>
                        {p.quantity} {t(p.unit)} · {money(p.normalized)} / {t(p.unit)}
                      </small>
                    </span>
                  </td>
                  <td>
                    {p.store_name}
                    <small>{rn(p.region)}</small>
                  </td>
                  <td className="sp-price">{money(p.amount)}</td>
                  <td className="sp-muted">{p.previous ? money(p.previous) : '—'}</td>
                  <td>
                    <Delta value={p.delta} />
                  </td>
                  <td>
                    <Stamp status={p.status} t={t} />
                  </td>
                  {!limited && (
                    <>
                      <td>{date(p.collected_at, true)}</td>
                      <td>{['manual', 'demo'].includes(p.source) ? t(p.source === 'demo' ? 'demo' : 'manual') : p.source}</td>
                    </>
                  )}
                  <td>
                    <ChevronRight size={15} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <div className="sp-empty">{t('empty')}</div>}
        </div>
        {!limited && (
          <div className="sp-pagination">
            <span>
              {t('showing')} {Math.min(offset + 1, list.length)}–{Math.min(offset + 20, list.length)} {t('of')} {list.length}
            </span>
            <div>
              <button className="sp-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>
                <ChevronLeft size={15} />
                {t('back')}
              </button>
              <button
                className="sp-btn"
                disabled={offset + 20 >= list.length}
                onClick={() => setOffset(offset + 20)}
              >
                {t('next')}
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  function chart(points: any[], key = 'value', withForecast = false) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ left: 0, right: 12, top: 15, bottom: 0 }}>
          <defs>
            <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2d7c94" stopOpacity={0.17} />
              <stop offset="100%" stopColor="#2d7c94" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#eaf0f4" strokeDasharray="3 4" />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            minTickGap={30}
            tickFormatter={(s) => date(s)}
            tick={{ fill: '#8492a4', fontSize: 11 }}
            dy={10}
          />
          <YAxis
            domain={['auto', 'auto']}
            axisLine={false}
            tickLine={false}
            width={54}
            tick={{ fill: '#8492a4', fontSize: 11 }}
            tickFormatter={(n) => n.toLocaleString()}
          />
          <Tooltip
            labelFormatter={(s) => date(String(s))}
            formatter={(n: number, name: string) => [
              money(n),
              name === 'forecast' ? t('forecastLine') : t(key === 'value' ? 'basketLine' : 'price'),
            ]}
            contentStyle={{ borderRadius: 10, border: '1px solid #e5ebf0', fontSize: 12 }}
          />
          <Area
            type="monotone"
            dataKey={key}
            stroke="#297c91"
            strokeWidth={2.5}
            fill="url(#priceArea)"
            connectNulls={false}
          />
          {withForecast && (
            <Line
              type="monotone"
              dataKey="forecast"
              stroke="#193a56"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 2.5 }}
              connectNulls={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  function rankings(desc: boolean) {
    const unique = new Map();
    for (const p of [...latest].sort((a: any, b: any) => (desc ? b.delta - a.delta : a.delta - b.delta))) {
      if ((desc ? p.delta > 0 : p.delta < 0) && !unique.has(p.product_id)) unique.set(p.product_id, p);
    }
    const list = Array.from(unique.values()).slice(0, 10);
    return (
      <section className="sp-card">
        <div className="sp-card-head">
          <h3>{t(desc ? 'rising' : 'falling')}</h3>
          <span className="sp-top">TOP 10</span>
        </div>
        <div className="sp-ranking">
          {list.map((p: any, i: number) => (
            <button key={p.id} onClick={() => openDetail(p)}>
              <span className="sp-rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="sp-rank-name">
                {pn(p)}
                <small>{p.store_name}</small>
              </span>
              <span>
                <Delta value={p.delta} />
                <small>{money(p.amount)}</small>
              </span>
            </button>
          ))}
          {!list.length && <div className="sp-empty">{t('empty')}</div>}
        </div>
      </section>
    );
  }

  if (!ready) {
    return (
      <div className="sp-loading">
        <Loader2 className="spin" />
        <span>{t('loading')}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="sp-login">
        <div className="sp-login-art">
          <div className="sp-brand">
            <span className="sp-logo">
              <Activity size={27} />
            </span>
            SMART<span>PRICE</span>
          </div>
          <div>
            <span className="sp-eyebrow">INTELLIGENT FOOD PRICE MONITORING · ӘМАТ / СЗПТ</span>
            <h1>{t('intelligence')}</h1>
            <p>{t('national')} · Kazakhstan · AI + OCR + Min/Median/Max</p>
            <div className="sp-orbit">
              <Activity size={100} />
              <i />
              <i />
              <i />
            </div>
          </div>
          <small>{t('copyright')} · SMART PRICE</small>
        </div>
        <div className="sp-login-body">
          <select aria-label={t('language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="kk">Қазақша</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
          <div className="sp-login-panel">
            <span className="sp-chip">{t('demoShort')}</span>
            <h2>{t('login')}</h2>
            <p>{t('loginNote')}</p>
            {[
              ['monitor', Activity],
              ['analyst', BrainCircuit],
              ['manager', ShieldCheck],
            ].map(([id, Icon]: any) => (
              <button key={id} className="sp-role-card" disabled={busy} onClick={() => login(id)}>
                <Icon size={22} />
                <span>
                  <strong>{t(id)}</strong>
                  <small>{t('p' + id[0].toUpperCase() + id.slice(1))}</small>
                </span>
                <ArrowRight size={19} />
              </button>
            ))}
            <div className="sp-disclaimer">
              <Database size={17} />
              {t('demoNote')}
            </div>
            {error && (
              <p role="alert">
                {errorText(error, lang)} <button onClick={refresh}>{t('retry')}</button>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sp-app">
      <aside className={'sp-sidebar ' + (mobile ? 'visible' : '')}>
        <a href="/" className="sp-brand">
          <span className="sp-logo">
            <Activity size={23} />
          </span>
          SMART<span>PRICE</span>
        </a>
        <div className="sp-workspace">
          <span className="sp-workspace-icon">KZ</span>
          <span>
            {t('national')}
            <small>
              Kazakhstan <span>· DEMO</span>
            </small>
          </span>
          <ChevronDown size={13} />
        </div>
        <div className="sp-nav-label">{t('workspace')}</div>
        <nav>
          {nav.map(([key, Icon], i) => (
            <React.Fragment key={key}>
              {i === 8 && <div className="sp-nav-label management">{t('management')}</div>}
              <button onClick={() => navigate(key)} className={page === key ? 'active' : ''}>
                <Icon size={18} />
                <span>{t(key)}</span>
                {key === 'verification' && alerts.length > 0 && <b>{alerts.length}</b>}
                {key === 'analytics' && <em>AI</em>}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="sp-side-bottom">
          <div className="sp-demo-box">
            <span className="sp-demo-icon">
              <Play size={15} fill="currentColor" />
            </span>
            <strong>{t('copyright')}</strong>
            <p>{t('demo')}</p>
            <button onClick={beginDemo} disabled={busy}>
              {t('startDemo')}
              <ArrowRight size={14} />
            </button>
          </div>
          <button className="sp-profile" onClick={() => setModal({ kind: 'role', title: 'switchRole' })}>
            <span className="sp-avatar">{data.user.name.slice(0, 1)}</span>
            <span>
              <strong>{data.user.name}</strong>
              <small>{t(role)}</small>
            </span>
            <ChevronDown size={13} />
          </button>
        </div>
      </aside>

      {mobile && <div className="sp-mobile-shade" onClick={() => setMobile(false)} />}

      <div className="sp-main">
        <header className="sp-topbar">
          <div>
            <button className="sp-icon-btn sp-mobile-menu" aria-label="Menu" onClick={() => setMobile(true)}>
              <Menu size={20} />
            </button>
            <span className="sp-breadcrumb">
              SMART PRICE <ChevronRight size={13} />
              <strong>{t(page)}</strong>
            </span>
          </div>
          <div className="sp-top-tools">
            <span className="sp-environment">
              <i />
              {data.ai?.configured ? `${t('aiLive')} · ${data.ai.model}` : t('aiLocal')}
            </span>
            <span className="sp-top-divider" />
            <Globe size={15} />
            <select aria-label={t('language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="kk">Қазақша</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
            <button className="sp-notification" aria-label={t('watchlist')} onClick={() => navigate('verification')}>
              <Bell size={19} />
              {alerts.length > 0 && <i />}
            </button>
            <button className="sp-avatar small" onClick={() => setModal({ kind: 'role', title: 'switchRole' })}>
              {data.user.name.slice(0, 1)}
            </button>
          </div>
        </header>

        <main className="sp-content">
          <div className="sp-page-heading">
            <div>
              <div className="sp-eyebrow">
                {t('national')} <span>/ KAZAKHSTAN</span>
              </div>
              <h1>
                {t(page)}
                <span className="sp-live">
                  <i />
                  LIVE
                </span>
              </h1>
              <p>
                {page === 'dashboard'
                  ? t('intelligence')
                  : page === 'analytics'
                  ? t('notViolation')
                  : page === 'products'
                  ? t('packageNote')
                  : page === 'reports'
                  ? t('reportNote')
                  : t('demoNote')}
              </p>
            </div>
            <div className="sp-heading-actions">
              <button className="sp-btn" onClick={() => navigate('analytics')}>
                <Sparkles size={15} />
                {t('analytics')}
              </button>
              <button className="sp-btn" onClick={() => navigate('reports')}>
                <Download size={15} />
                {t('reports')}
              </button>
              {isMonitor && (
                <button className="sp-btn primary" onClick={newPrice}>
                  <Plus size={17} />
                  {t('addPrice')}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="sp-error" role="alert">
              {errorText(error, lang)}
              <button onClick={refresh}>{t('retry')}</button>
            </div>
          )}

          {demo > 0 && (
            <div className="sp-demo-flow">
              <div className="sp-demo-step">
                0{demo}
                <span>/ 04</span>
              </div>
              <div>
                <strong>{t('demo' + demo)}</strong>
                <p>
                  {t(
                    demo === 1 ? 'demoIntro' : demo === 2 ? 'demoSaved' : demo === 3 ? 'demoReview' : 'demoComplete'
                  )}
                </p>
              </div>
              <button
                className="sp-btn primary"
                disabled={busy}
                onClick={demo === 1 ? demoSubmit : demoNext}
              >
                {t(demo === 1 ? 'addPrice' : demo === 3 ? 'viewResult' : demo === 4 ? 'done' : 'next')}
                <ArrowRight size={15} />
              </button>
              <button className="sp-icon-btn" aria-label={t('close')} onClick={() => setDemo(0)}>
                <X size={18} />
              </button>
            </div>
          )}

          {!['users', 'settings', 'history'].includes(page) && (
            <div className="sp-filterbar">
              <div>
                <MapPin size={15} />
                <select aria-label={t('region')} value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="">{t('allRegions')}</option>
                  {data.regions.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {regionName(r, lang)}
                    </option>
                  ))}
                </select>
              </div>
              {['dashboard', 'map', 'analytics'].includes(page) ? (
                <div>
                  <History size={15} />
                  <select aria-label={t('period')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {[7, 14, 28].map((n) => (
                      <option key={n} value={n}>
                        {n} {t('days')}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <Package size={15} />
                  <select aria-label={t('product')} value={product} onChange={(e) => setProduct(e.target.value)}>
                    <option value="">{t('allProducts')}</option>
                    {data.products.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {pn(p)} · {p.quantity} {t(p.unit)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <span className="sp-updated">
                <i />
                {t('updated')}: {stamp}
              </span>
              <button className="sp-icon-btn" onClick={refresh} aria-label={t('refresh')}>
                <RefreshCw size={15} />
              </button>
            </div>
          )}

          {page === 'dashboard' && (
            <>
              <div className="sp-stats">
                {[
                  ['totalProducts', data.products.length, Package, 'navy'],
                  ['totalStores', data.stores.filter((s: any) => !region || s.region === region).length, Store, 'blue'],
                  ['totalPrices', scoped.length, Activity, 'teal'],
                  ['basket', basketValue == null ? '—' : money(basketValue), ShoppingBasket, 'navy'],
                  ['growing', new Set(latest.filter((p: any) => p.delta > 0).map((p: any) => p.product_id)).size, TrendingUp, 'red'],
                  ['anomalies', alerts.length, ShieldCheck, 'orange'],
                ].map(([key, value, Icon, color]: any) => (
                  <button
                    key={key}
                    className={'sp-stat ' + color}
                    onClick={() =>
                      navigate(
                        key === 'totalProducts'
                          ? 'products'
                          : key === 'totalStores'
                          ? 'stores'
                          : key === 'anomalies'
                          ? 'verification'
                          : key === 'basket'
                          ? 'analytics'
                          : 'monitoring'
                      )
                    }
                  >
                    <div className="sp-stat-label">
                      {t(key)}
                      <Icon size={17} />
                    </div>
                    <strong>{typeof value === 'number' ? value.toLocaleString(locale) : value}</strong>
                    <span>
                      {key === 'anomalies' ? t('pending') : key === 'basket' ? 'KZT / ' + t('basket') : t('demo')}
                      <ArrowUpRight size={13} />
                    </span>
                  </button>
                ))}
              </div>

              <div className="sp-chart-row">
                <section className="sp-card sp-trend">
                  <div className="sp-card-head">
                    <div>
                      <h3>{t('trend')}</h3>
                      <p>{t('trendNote')}</p>
                    </div>
                    <div className="sp-inline-actions">
                      <span className="sp-chart-legend">
                        <i />
                        {t('basketLine')}
                      </span>
                      {forecast.summary && (
                        <span className="sp-chip">
                          {t('forecastLine')}: {money(forecast.summary.forecastEnd)} (
                          {forecast.summary.changePct > 0 ? '+' : ''}
                          {forecast.summary.changePct}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="sp-chart-value">
                    {basketValue == null ? '—' : money(basketValue)}
                    <span>KZT</span>
                    <Delta
                      value={
                        series[0]?.value && basketValue
                          ? ((basketValue - series[0].value) / series[0].value) * 100
                          : 0
                      }
                    />
                  </div>
                  <div className="sp-chart">{chart(forecast.series, 'value', true)}</div>
                </section>

                <section className="sp-card sp-coverage">
                  <div className="sp-card-head">
                    <div>
                      <h3>{t('coverage')}</h3>
                      <p>{t('coverageNote')}</p>
                    </div>
                    <span className="sp-kz-tag">KZ</span>
                  </div>
                  <KazakhstanMap
                    regions={data.regions}
                    stores={[]}
                    prices={latest}
                    selected={region}
                    lang={lang}
                    compact
                    onSelect={(id: string) => {
                      setRegion(id);
                      navigate('map');
                    }}
                  />
                  <div className="sp-map-summary">
                    <span>
                      <i className="green" />
                      {t('falling')}
                    </span>
                    <span>
                      <i className="orange" />
                      {t('pending')}
                    </span>
                  </div>
                  <button className="sp-map-link" onClick={() => navigate('map')}>
                    {t('openMap')}
                    <ArrowRight size={15} />
                  </button>
                </section>
              </div>

              <div className="sp-observation-row">
                <section className="sp-card">
                  <div className="sp-card-head">
                    <h3>
                      {t('recent')}
                      <span className="sp-count">{scoped.length}</span>
                    </h3>
                    <button className="sp-text-btn" onClick={() => navigate('monitoring')}>
                      {t('viewAll')}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {priceTable(scoped, true)}
                </section>

                <section className="sp-card sp-watchlist">
                  <div className="sp-card-head">
                    <h3>
                      <AlertTriangle size={16} />
                      {t('watchlist')}
                    </h3>
                    <span className="sp-count orange">{alerts.length}</span>
                  </div>
                  {alerts.slice(0, 3).map((p: any) => (
                    <button className="sp-alert-item" key={p.id} onClick={() => openDetail(p)}>
                      <span className="sp-alert-line">
                        <strong>{pn(p)}</strong>
                        <Delta value={p.delta} />
                      </span>
                      <p>
                        {p.store_name} · {money(p.previous)} → {money(p.amount)}
                      </p>
                      <small>
                        {rn(p.region)}
                        <ChevronRight size={13} />
                      </small>
                    </button>
                  ))}
                  {alerts.length === 0 && <div className="sp-empty">{t('empty')}</div>}
                  <p className="sp-alert-note">{t('notViolation')}</p>
                </section>
              </div>

              <div className="sp-two-col">
                {rankings(true)}
                {rankings(false)}
              </div>
            </>
          )}

          {page === 'map' && (
            <>
              <div className="sp-card sp-map-card">
                <KazakhstanMap
                  regions={data.regions}
                  stores={data.stores.filter((s: any) => !region || s.region === region)}
                  prices={latest}
                  selected={region}
                  onSelect={setRegion}
                  lang={lang}
                />
                <p className="sp-map-note">{t('mapNote')}</p>
              </div>
              <RegionalStats data={data} latest={latest} lang={lang} onSelect={setRegion} productId={product} />
              <div className="sp-two-col">
                <section className="sp-card">
                  <div className="sp-card-head">
                    <h3>{t('stores')}</h3>
                  </div>
                  {data.stores
                    .filter((s: any) => !region || s.region === region)
                    .map((s: any) => (
                      <div className="sp-store-line" key={s.id}>
                        <MapPin size={17} />
                        <div>
                          <strong>{s.name}</strong>
                          <small>
                            {s.city} · {s.address || t('unknownAddress')} ·{' '}
                            {s.lat == null ? t('unknownGps') : s.lat + ', ' + s.lng}
                          </small>
                        </div>
                      </div>
                    ))}
                </section>
                <section className="sp-card">
                  <div className="sp-card-head">
                    <h3>{t('trend')}</h3>
                  </div>
                  <div className="sp-chart">{chart(forecast.series, 'value', true)}</div>
                </section>
              </div>
            </>
          )}

          {['monitoring', 'verification'].includes(page) && (
            <section className="sp-card">
              <div className="sp-card-head">
                <h3>
                  {t(page)}
                  <span className="sp-count">{filtered.length}</span>
                </h3>
                <div className="sp-inline-actions">
                  {isMonitor && (
                    <button className="sp-btn" onClick={() => setModal({ kind: 'import', title: 'import' })}>
                      <Upload size={15} />
                      {t('import')}
                    </button>
                  )}
                  <a className="sp-btn" href={exportUrl()}>
                    <Download size={15} />
                    {t('exportExcel')}
                  </a>
                </div>
              </div>
              <div className="sp-table-tools">
                <label className="sp-search">
                  <Search size={16} />
                  <input placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <select aria-label={t('status')} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">{t('allStatuses')}</option>
                  {['pending', 'unreviewed', 'verified', 'rejected'].map((k) => (
                    <option key={k} value={k}>
                      {t(k)}
                    </option>
                  ))}
                </select>
                <select aria-label={t('store')} value={store} onChange={(e) => setStore(e.target.value)}>
                  <option value="">{t('allStores')}</option>
                  {data.stores
                    .filter((s: any) => !region || s.region === region)
                    .map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
                <input type="date" aria-label={t('from')} value={from} onChange={(e) => setFrom(e.target.value)} />
                <input type="date" aria-label={t('to')} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              {priceTable(filtered)}
            </section>
          )}

          {page === 'products' && (
            <section className="sp-card">
              <div className="sp-card-head">
                <h3>
                  {t('products')}
                  <span className="sp-count">{data.products.length}</span>
                </h3>
                {isMonitor && (
                  <button className="sp-btn primary" onClick={() => newProduct()}>
                    <Plus size={16} />
                    {t('addProduct')}
                  </button>
                )}
              </div>
              <div className="sp-table-tools">
                <label className="sp-search">
                  <Search size={16} />
                  <input placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <select
                  aria-label={t('allCategories')}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">{t('allCategories')}</option>
                  {['dairy', 'grocery', 'vegetables', 'other'].map((k) => (
                    <option key={k} value={k}>
                      {t(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sp-product-grid">
                {data.products
                  .filter(
                    (p: any) => (!category || p.category === category) && pn(p).toLowerCase().includes(query.toLowerCase())
                  )
                  .map((p: any) => {
                    const pList = latest.filter((x: any) => x.product_id === p.id);
                    const stats = computeMinMedianMax(pList, 'normalized');
                    return (
                      <article className="sp-product-card" key={p.id}>
                        <div className={'sp-product-art ' + p.category}>
                          {p.category === 'vegetables' ? (
                            <Leaf size={38} strokeWidth={1.3} />
                          ) : p.category === 'dairy' ? (
                            <Layers size={38} strokeWidth={1.3} />
                          ) : (
                            <Package size={38} strokeWidth={1.3} />
                          )}
                          <span>{t(p.category)}</span>
                        </div>
                        <h3>{pn(p)}</h3>
                        <p>
                          {p.brand} · {p.quantity} {t(p.unit)} · {t(p.packaging)}
                        </p>
                        <dl>
                          <dt>{t('minPrice')}</dt>
                          <dd>{stats ? money(stats.min) : '—'}</dd>
                          <dt>{t('medianPrice')}</dt>
                          <dd>{stats ? money(stats.median) : '—'}</dd>
                          <dt>{t('maxPrice')}</dt>
                          <dd>{stats ? money(stats.max) : '—'}</dd>
                          {p.fat != null && (
                            <>
                              <dt>{t('fat')}</dt>
                              <dd>{p.fat}%</dd>
                            </>
                          )}
                        </dl>
                        <div className="sp-product-bottom">
                          <span>
                            <small>{t('medianPrice')}</small>
                            <strong>
                              {stats ? money(stats.median) : '—'}
                              <small> / {t(p.unit)}</small>
                            </strong>
                          </span>
                          <button
                            className="sp-icon-btn"
                            aria-label={t('comparison')}
                            onClick={() => {
                              setProduct(p.id);
                              setPage('analytics');
                            }}
                          >
                            <ArrowUpRight size={19} />
                          </button>
                          {isMonitor && (
                            <>
                              <button className="sp-icon-btn" aria-label={t('edit')} onClick={() => newProduct(p)}>
                                <Pencil size={15} />
                              </button>
                              <button
                                className="sp-icon-btn danger"
                                aria-label={t('delete')}
                                onClick={() =>
                                  setModal({ kind: 'delete', entity: 'products', id: p.id, title: 'confirmDelete' })
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
              </div>
            </section>
          )}

          {page === 'stores' && (
            <section className="sp-card">
              <div className="sp-card-head">
                <h3>{t('stores')}</h3>
                {isMonitor && (
                  <button className="sp-btn primary" onClick={() => newStore()}>
                    <Plus size={16} />
                    {t('addStore')}
                  </button>
                )}
              </div>
              <div className="sp-table-tools">
                <label className="sp-search">
                  <Search size={16} />
                  <input placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
              </div>
              <div className="sp-table-wrap">
                <table className="sp-table">
                  <thead>
                    <tr>
                      {['name', 'type', 'region', 'address', 'lastCheck', 'status', 'actions'].map((k) => (
                        <th key={k}>{t(k)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.stores
                      .filter(
                        (s: any) =>
                          (!region || s.region === region) &&
                          [s.name, s.city].join(' ').toLowerCase().includes(query.toLowerCase())
                      )
                      .map((s: any) => (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.name}</strong>
                            <small>{s.city}</small>
                          </td>
                          <td>{t(s.type === 'store' ? 'storeType' : s.type)}</td>
                          <td>{rn(s.region)}</td>
                          <td>
                            {s.address || t('unknownAddress')}
                            <small>{s.lat != null ? s.lat + ', ' + s.lng : t('unknownGps')}</small>
                          </td>
                          <td>{s.last_check ? date(s.last_check, true) : '—'}</td>
                          <td>
                            <span className={'sp-stamp ' + (s.monitoring ? 'verified' : 'rejected')}>
                              <i />
                              {s.monitoring ? t('active') : t('readOnly')}
                            </span>
                          </td>
                          <td>
                            {isMonitor && (
                              <div className="sp-inline-actions">
                                <button className="sp-icon-btn" aria-label={t('edit')} onClick={() => newStore(s)}>
                                  <Pencil size={15} />
                                </button>
                                <button
                                  className="sp-icon-btn danger"
                                  aria-label={t('delete')}
                                  onClick={() =>
                                    setModal({ kind: 'delete', entity: 'stores', id: s.id, title: 'confirmDelete' })
                                  }
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {page === 'analytics' && (
            <>
              <div className="sp-method">
                <BrainCircuit size={26} />
                <div>
                  <h3>
                    {t('method')} ·{' '}
                    <span className="sp-chip">
                      {data.ai?.configured ? `${t('aiLive')}: ${data.ai.model}` : t('aiLocal')}
                    </span>
                  </h3>
                  <p>{t('methodText')}</p>
                </div>
              </div>

              <AiAnalyticsPanel
                data={data}
                scoped={scoped}
                latest={latest}
                series={series}
                forecast={forecast}
                product={product}
                setProduct={setProduct}
                lang={lang}
                onSelectRegion={setRegion}
                api={api}
              />

              <div className="sp-two-col">
                {rankings(true)}
                {rankings(false)}
              </div>

              <section className="sp-card">
                <div className="sp-card-head">
                  <h3>{t('comparison')}</h3>
                  <select aria-label={t('product')} value={product} onChange={(e) => setProduct(e.target.value)}>
                    <option value="">{t('allProducts')}</option>
                    {data.products.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {pn(p)} · {p.quantity} {t(p.unit)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="sp-section-note">{t('notComparable')}</p>
                {priceTable(latest)}
              </section>

              <section className="sp-card">
                <div className="sp-card-head">
                  <div>
                    <h3>{t('matching')}</h3>
                    <p>{t('matchingNote')}</p>
                  </div>
                </div>
                {data.matches.map((m: any) => {
                  const a = data.products.find((p: any) => p.id === m.left_id);
                  const b = data.products.find((p: any) => p.id === m.right_id);
                  if (!a || !b) return null;
                  return (
                    <div className="sp-match" key={m.id}>
                      <Package size={24} />
                      <div>
                        <strong>
                          {pn(a)} · {a.quantity} {t(a.unit)} ↔ {pn(b)} · {b.quantity} {t(b.unit)}
                        </strong>
                        <small>
                          {a.brand} · {a.manufacturer} · {a.fat}% · {t(a.packaging)} · {t('confidence')} {m.score}%
                        </small>
                      </div>
                      <Stamp status={m.status} t={t} />
                      {isAnalyst && m.status === 'pending' && (
                        <>
                          <button
                            className="sp-btn"
                            disabled={busy}
                            onClick={() => action('match', { id: m.id, status: 'rejected' })}
                          >
                            {t('rejectMatch')}
                          </button>
                          <button
                            className="sp-btn primary"
                            disabled={busy}
                            onClick={() => action('match', { id: m.id, status: 'confirmed' })}
                          >
                            <Check size={15} />
                            {t('confirmMatch')}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>
            </>
          )}

          {page === 'history' && (
            <section className="sp-card">
              <div className="sp-card-head">
                <h3>{t('history')}</h3>
                <button className="sp-icon-btn" aria-label={t('refresh')} onClick={refresh}>
                  <RefreshCw size={16} />
                </button>
              </div>
              <div className="sp-timeline">
                {data.audit.map((a: any) => {
                  let parsedDetails: any = {};
                  try {
                    parsedDetails = a.details ? JSON.parse(a.details) : {};
                  } catch {}
                  return (
                    <div key={a.id}>
                      <span className="sp-timeline-dot">
                        <Check size={12} />
                      </span>
                      <div>
                        <strong>{t(a.action === 'evidence' ? 'evidenceEvent' : a.action)}</strong>
                        <p>
                          {a.author} ·{' '}
                          {t(
                            a.entity === 'price'
                              ? 'price'
                              : a.entity === 'match'
                              ? 'matching'
                              : a.entity === 'product'
                              ? 'product'
                              : a.entity === 'ai'
                              ? 'analytics'
                              : 'store'
                          )}{' '}
                          <code>{a.entity_id.slice(0, 13)}</code>
                        </p>
                        {parsedDetails.comment && <blockquote>{parsedDetails.comment}</blockquote>}
                        {parsedDetails.model && (
                          <small>
                            {parsedDetails.model} · {parsedDetails.mode || ''}
                          </small>
                        )}
                      </div>
                      <time>{date(a.created_at, true)}</time>
                    </div>
                  );
                })}
                {!data.audit.length && <div className="sp-empty">{t('empty')}</div>}
              </div>
            </section>
          )}

          {page === 'reports' && (
            <div className="sp-report">
              <div className="sp-print-header">
                <h1>SMART PRICE</h1>
                <p>
                  {t('demo')} · {new Date().toLocaleDateString(locale)}
                </p>
              </div>
              <section className="sp-card">
                <div className="sp-card-head">
                  <div>
                    <h3>{t('reports')}</h3>
                    <p>{t('reportNote')}</p>
                  </div>
                  <div className="sp-inline-actions">
                    <a className="sp-btn primary" href={exportUrl()}>
                      <Download size={16} />
                      {t('exportExcel')}
                    </a>
                    <button className="sp-btn" onClick={() => window.print()}>
                      <FileBarChart size={16} />
                      {t('exportPdf')}
                    </button>
                  </div>
                </div>
                <div className="sp-table-tools">
                  <select aria-label={t('store')} value={store} onChange={(e) => setStore(e.target.value)}>
                    <option value="">{t('allStores')}</option>
                    {data.stores.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <label>
                    {t('from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </label>
                  <label>
                    {t('to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </label>
                </div>
                <div className="sp-report-metrics">
                  <span>
                    {t('totalPrices')}
                    <strong>{scoped.length}</strong>
                  </span>
                  <span>
                    {t('basket')}
                    <strong>{basketValue == null ? '—' : money(basketValue)}</strong>
                  </span>
                  <span>
                    {t('forecastLine')}
                    <strong>{forecast.summary ? money(forecast.summary.forecastEnd) : '—'}</strong>
                  </span>
                  <span>
                    {t('anomalies')}
                    <strong>{alerts.length}</strong>
                  </span>
                </div>
                <p className="sp-section-note">{t('basketNote')}</p>
                <div className="sp-chart">{chart(forecast.series, 'value', true)}</div>
              </section>

              <RegionalStats data={data} latest={latest} lang={lang} onSelect={setRegion} productId={product} />

              <section className="sp-card">
                <div className="sp-card-head">
                  <h3>{t('comparison')}</h3>
                </div>
                <div className="sp-screen-table">{priceTable(latest, true)}</div>
                <div className="sp-print-table">
                  <table className="sp-table">
                    <thead>
                      <tr>
                        {['product', 'store', 'normalized', 'delta', 'status'].map((k) => (
                          <th key={k}>{t(k)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {latest.map((p: any) => (
                        <tr key={p.id}>
                          <td>{pn(p)}</td>
                          <td>{p.store_name}</td>
                          <td>
                            {money(p.normalized)} / {t(p.unit)}
                          </td>
                          <td>{p.delta}%</td>
                          <td>{t(p.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {page === 'users' && (
            <section className="sp-card">
              <div className="sp-card-head">
                <div>
                  <h3>{t('users')}</h3>
                  <p>{t('roleNote')}</p>
                </div>
              </div>
              <div className="sp-team-grid">
                {data.users.map((u: any) => (
                  <article key={u.id}>
                    <span className="sp-avatar large">{u.name.slice(0, 1)}</span>
                    <h3>{u.name}</h3>
                    <span className="sp-chip">{t(u.role)}</span>
                    <p>{t('p' + u.role[0].toUpperCase() + u.role.slice(1))}</p>
                    <button
                      className="sp-btn"
                      disabled={busy || u.id === data.user.id}
                      onClick={() => login(u.id)}
                    >
                      {u.id === data.user.id ? <Check size={16} /> : <ArrowRight size={16} />}{' '}
                      {u.id === data.user.id ? t('active') : t('switchRole')}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {page === 'settings' && (
            <section className="sp-card sp-settings">
              <div className="sp-card-head">
                <h3>{t('settings')}</h3>
              </div>
              <div>
                <Globe size={22} />
                <span>
                  <h3>{t('language')}</h3>
                  <p>Қазақша · Русский · English</p>
                </span>
                <select value={lang} aria-label={t('language')} onChange={(e) => setLang(e.target.value as Lang)}>
                  <option value="kk">Қазақша</option>
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div>
                <Sparkles size={22} />
                <span style={{ flex: 1 }}>
                  <h3>
                    {t('aiConfigTitle')} ·{' '}
                    <span className="sp-chip">
                      {data.ai?.configured ? `${t('aiLive')} (${data.ai.maskedKey})` : t('aiLocal')}
                    </span>
                  </h3>
                  <p>{t('aiConfigNote')}</p>
                  <div className="sp-ai-settings-grid">
                    <label>
                      Provider
                      <select
                        value={aiForm.provider}
                        onChange={(e) => setAiForm({ ...aiForm, provider: e.target.value })}
                      >
                        <option value="openai-compatible">OpenAI-compatible (alem.ai / OpenAI / Groq)</option>
                        <option value="gemini">Google Gemini REST</option>
                      </select>
                    </label>
                    <label>
                      Base URL
                      <input
                        value={aiForm.baseUrl}
                        onChange={(e) => setAiForm({ ...aiForm, baseUrl: e.target.value })}
                        placeholder="https://llm.alem.ai/v1"
                      />
                    </label>
                    <label>
                      Model
                      <input
                        value={aiForm.model}
                        onChange={(e) => setAiForm({ ...aiForm, model: e.target.value })}
                        placeholder="qwen3-8"
                      />
                    </label>
                    <label>
                      API Key ({data.ai?.maskedKey || 'unset'})
                      <input
                        type="password"
                        value={aiForm.apiKey}
                        onChange={(e) => setAiForm({ ...aiForm, apiKey: e.target.value })}
                        placeholder="sk-..."
                      />
                    </label>
                  </div>
                  <div className="sp-inline-actions" style={{ marginTop: 12 }}>
                    {(isMonitor || isAnalyst) && (
                      <button
                        className="sp-btn primary"
                        disabled={busy}
                        onClick={async () => {
                          await action('ai/config', aiForm, false);
                        }}
                      >
                        <Check size={14} />
                        {t('save')}
                      </button>
                    )}
                    <button
                      className="sp-btn"
                      disabled={aiBusy}
                      onClick={async () => {
                        setAiBusy(true);
                        try {
                          const r = await api('ai/test', {});
                          setAiTestMsg(`${t('aiConnectedOk')} · ${r.model} (${r.latencyMs}ms)`);
                          toast.success(t('aiConnectedOk'));
                        } catch (e: any) {
                          setAiTestMsg(errorText(e.message, lang));
                          toast.error(errorText(e.message, lang));
                        } finally {
                          setAiBusy(false);
                        }
                      }}
                    >
                      {aiBusy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                      {t('testAi')}
                    </button>
                    {aiTestMsg && <span className="sp-chip">{aiTestMsg}</span>}
                  </div>
                </span>
              </div>
              <div>
                <Database size={22} />
                <span>
                  <h3>{t('storage')}</h3>
                  <p>{t('storageNote')}</p>
                </span>
                <span className="sp-chip">SQLite</span>
              </div>
              <div>
                <BrainCircuit size={22} />
                <span>
                  <h3>{t('method')}</h3>
                  <p>{t('methodText')}</p>
                </span>
              </div>
              <div>
                <ExternalLink size={22} />
                <span>
                  <h3>SMART PRICE</h3>
                  <p>{t('architecture')}</p>
                </span>
                <a href="/erp" className="sp-btn" target="_blank" rel="noreferrer">
                  {t('legacy')}
                  <ArrowUpRight size={16} />
                </a>
              </div>
              <div>
                <LogOut size={22} />
                <span>
                  <h3>{data.user.name}</h3>
                  <p>{t(role)}</p>
                </span>
                <button
                  className="sp-btn"
                  onClick={async () => {
                    await api('logout', {});
                    setData(null);
                    setDemo(0);
                  }}
                >
                  {t('signout')}
                </button>
              </div>
            </section>
          )}

          <footer className="sp-footer">
            <span>
              <Activity size={13} />
              SMART PRICE <b>·</b> {t('architecture')}
            </span>
            <span>
              {t('copyright')}
              <i />
              {t('demo')}
            </span>
          </footer>
        </main>
      </div>

      <input
        hidden
        ref={photoRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => uploadPhoto(e.target.files?.[0])}
      />

      {(modal || detail) && (
        <div
          className="sp-modal-shade"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setModal(null);
              setDetail(null);
            }
          }}
        >
          <div
            ref={dialogRef}
            className={'sp-modal ' + (detail ? 'detail' : modal?.kind === 'import' ? 'detail' : '')}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sp-dialog-title"
          >
            <div className="sp-modal-head">
              <div>
                <span className="sp-eyebrow">SMART PRICE / DEMO</span>
                <h2 id="sp-dialog-title">{detail ? t('details') : t(modal.title)}</h2>
              </div>
              <button
                className="sp-icon-btn"
                aria-label={t('close')}
                onClick={() => {
                  setModal(null);
                  setDetail(null);
                }}
              >
                <X size={20} />
              </button>
            </div>

            {detail ? (
              <>
                <div className="sp-detail-summary">
                  <div>
                    <h2>
                      {pn(detail)}{' '}
                      <small>
                        {detail.quantity} {t(detail.unit)}
                      </small>
                    </h2>
                    <p>
                      {detail.store_name} · {rn(detail.region)}
                    </p>
                  </div>
                  <Stamp status={detail.status} t={t} />
                </div>

                <div className="sp-detail-prices">
                  <span>
                    {t('previous')}
                    <strong>{detail.previous ? money(detail.previous) : '—'}</strong>
                  </span>
                  <ArrowRight size={22} />
                  <span>
                    {t('current')}
                    <strong>{money(detail.amount)}</strong>
                  </span>
                  <Delta value={detail.delta} />
                  {detailMarketStats && (
                    <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      {t('minPrice')} / {t('medianPrice')} / {t('maxPrice')}
                      <strong style={{ fontSize: 13 }}>
                        {money(detailMarketStats.min)} / {money(detailMarketStats.median)} / {money(detailMarketStats.max)}
                      </strong>
                    </span>
                  )}
                </div>

                <p className="sp-section-note">
                  {date(detail.collected_at, true)} · {detail.author} · {t('normalized')}:{' '}
                  <b>
                    {money(detail.normalized)} / {t(detail.unit)}
                  </b>
                </p>

                {/* AI Anomaly Diagnosis Box */}
                <div className="sp-ai-detail-box">
                  <div className="sp-ai-detail-head">
                    <strong>
                      <Sparkles size={15} />
                      {t('aiDiagnosis')}
                    </strong>
                    <button type="button" className="sp-btn primary" disabled={aiBusy} onClick={runAiExplain}>
                      {aiBusy ? <Loader2 size={14} className="spin" /> : <BrainCircuit size={14} />}
                      {aiBusy ? t('aiAnalyzing') : t('aiAnalyze')}
                    </button>
                  </div>
                  {aiExplain && (
                    <div className="sp-ai-detail-body">
                      <div className="sp-ai-meta">
                        <span className="sp-chip">{aiExplain.model}</span>
                        {aiExplain.stats?.zScore != null && (
                          <span className="sp-chip">
                            {t('zScore')}: {aiExplain.stats.zScore}
                          </span>
                        )}
                        <span className={'sp-stamp ' + (aiExplain.riskLevel === 'high' ? 'rejected' : 'pending')}>
                          <i />
                          {aiExplain.riskLevel}
                        </span>
                      </div>
                      <p>{aiExplain.summary}</p>
                      {aiExplain.hypotheses?.length > 0 && (
                        <div className="sp-ai-cols">
                          <div>
                            <strong>{t('hypotheses')}</strong>
                            <ul>
                              {aiExplain.hypotheses.map((h: string, idx: number) => (
                                <li key={idx}>{h}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <strong>{t('checklist')}</strong>
                            <ul>
                              {aiExplain.checklist?.map((c: string, idx: number) => (
                                <li key={idx}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                      {isAnalyst && aiExplain.draftConclusion && (
                        <button
                          type="button"
                          className="sp-btn"
                          onClick={() => setComment(aiExplain.draftConclusion)}
                        >
                          <Check size={14} />
                          {t('useConclusion')}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="sp-detail-chart">
                  <h3>{t('priceHistory')}</h3>
                  {chart(
                    data.prices
                      .filter(
                        (p: any) =>
                          p.product_id === detail.product_id &&
                          p.store_id === detail.store_id &&
                          p.status !== 'rejected'
                      )
                      .slice(0, 35)
                      .reverse()
                      .map((p: any) => ({ day: p.collected_at, amount: p.amount })),
                    'amount'
                  )}
                </div>

                <div className="sp-detail-bottom">
                  <section>
                    <h3>
                      <MessageSquare size={16} />
                      {t('comment')}
                    </h3>
                    {details.comments.map((c: any) => (
                      <div className="sp-comment" key={c.id}>
                        <strong>
                          {c.author}
                          <time>{date(c.created_at, true)}</time>
                        </strong>
                        <p>{c.body}</p>
                      </div>
                    ))}
                    {(isMonitor || isAnalyst) && (
                      <>
                        <textarea
                          placeholder={isAnalyst ? t('conclusion') : t('comment')}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          maxLength={4000}
                        />
                        <div className="sp-inline-actions">
                          <button
                            className="sp-btn"
                            disabled={busy || !comment.trim()}
                            onClick={() => detailAction('comment', {})}
                          >
                            {t('send')}
                          </button>
                          {isMonitor && (
                            <button
                              className="sp-btn"
                              disabled={busy || !comment.trim()}
                              onClick={() => detailAction('comment', { escalate: true })}
                            >
                              {t('escalate')}
                            </button>
                          )}
                        </div>
                        {isAnalyst && (
                          <div className="sp-review-actions">
                            <button
                              className="sp-btn danger"
                              disabled={busy || !comment.trim()}
                              onClick={() => detailAction('review', { status: 'rejected' })}
                            >
                              {t('reject')}
                            </button>
                            <button
                              className="sp-btn primary"
                              disabled={busy || !comment.trim()}
                              onClick={() => detailAction('review', { status: 'verified' })}
                            >
                              <Check size={15} />
                              {t('approve')}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </section>

                  <section>
                    <h3>
                      <Camera size={16} />
                      {t('evidence')}
                    </h3>
                    <div className="sp-evidence-grid">
                      {details.evidence.map((e: any) => (
                        <a key={e.id} href={'/api/smartprice/evidence/' + e.id} target="_blank" rel="noreferrer">
                          <img src={'/api/smartprice/evidence/' + e.id} alt={e.comment || t('photo')} />
                          <small>
                            {e.author} · {date(e.created_at, true)}
                          </small>
                          <p>{e.comment}</p>
                        </a>
                      ))}
                    </div>
                    <p className="sp-section-note">{t('imageLimit')}</p>
                    {isMonitor && (
                      <button className="sp-btn" disabled={busy} onClick={() => photoRef.current?.click()}>
                        <Upload size={15} />
                        {t('upload')}
                      </button>
                    )}
                    {isMonitor && detail.author_id === data.user.id && detail.status !== 'verified' && (
                      <button
                        className="sp-btn"
                        onClick={() => {
                          setDetail(null);
                          setModal({ kind: 'price-edit', title: 'edit', values: { id: detail.id, amount: detail.amount } });
                        }}
                      >
                        <Pencil size={14} />
                        {t('edit')}
                      </button>
                    )}
                  </section>
                </div>
                <p className="sp-alert-note">{t('notViolation')}</p>
              </>
            ) : modal.kind === 'role' ? (
              <div className="sp-role-list">
                <p>{t('roleNote')}</p>
                {['monitor', 'analyst', 'manager'].map((id) => (
                  <button
                    className="sp-role-card"
                    disabled={busy}
                    key={id}
                    onClick={async () => {
                      await login(id);
                      setModal(null);
                    }}
                  >
                    <span className="sp-avatar">{id[0].toUpperCase()}</span>
                    <span>
                      <strong>{t(id)}</strong>
                      <small>{t('p' + id[0].toUpperCase() + id.slice(1))}</small>
                    </span>
                    {id === role ? <Check size={20} /> : <ArrowRight size={20} />}
                  </button>
                ))}
              </div>
            ) : modal.kind === 'delete' ? (
              <div className="sp-delete-dialog">
                <p>{t('confirmDelete')}</p>
                <div className="sp-inline-actions">
                  <button className="sp-btn" onClick={() => setModal(null)}>
                    {t('cancel')}
                  </button>
                  <button
                    className="sp-btn danger"
                    disabled={busy}
                    onClick={() => action(modal.entity, { id: modal.id, delete: true })}
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>
            ) : modal.kind === 'import' ? (
              <SmartImportModal
                data={data}
                lang={lang}
                onImported={async () => {
                  await refresh();
                }}
                onClose={() => setModal(null)}
              />
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const values = { ...modal.values };
                  if (modal.kind === 'prices') values.collected_at = new Date(values.collected_at).toISOString();
                  await action(modal.kind, values);
                }}
              >
                {modal.kind === 'prices' && (
                  <PriceTagScanner
                    products={data.products}
                    lang={lang}
                    onApply={(patch) =>
                      setModal((m: any) => ({ ...m, values: { ...m.values, ...patch } }))
                    }
                  />
                )}
                <div className="sp-form-grid">
                  {(() => {
                    const v = modal.values;
                    const fields =
                      modal.kind === 'prices'
                        ? [
                            [
                              'product_id',
                              'product',
                              'select',
                              data.products.map((p: any) => [p.id, pn(p) + ' · ' + p.quantity + ' ' + t(p.unit)]),
                            ],
                            [
                              'store_id',
                              'store',
                              'select',
                              data.stores.filter((s: any) => s.monitoring).map((s: any) => [s.id, s.name]),
                            ],
                            ['amount', 'price', 'number'],
                            ['collected_at', 'collected', 'datetime-local'],
                            [
                              'source',
                              'source',
                              'select',
                              [
                                ['manual', t('manual')],
                                ['photo', t('photo')],
                              ],
                            ],
                          ]
                        : modal.kind === 'price-edit'
                        ? [['amount', 'price', 'number']]
                        : modal.kind === 'stores'
                        ? [
                            ['name', 'name', 'text'],
                            [
                              'type',
                              'type',
                              'select',
                              ['supermarket', 'store', 'market'].map((k) => [k, t(k === 'store' ? 'storeType' : k)]),
                            ],
                            ['region', 'region', 'select', data.regions.map((r: any) => [r.id, regionName(r, lang)])],
                            ['city', 'city', 'text'],
                            ['address', 'address', 'optional'],
                            ['lat', 'lat', 'optionalNumber'],
                            ['lng', 'lng', 'optionalNumber'],
                            ['monitoring', 'active', 'checkbox'],
                          ]
                        : [
                            ['name', 'name (Русский)', 'text'],
                            ['name_kk', 'name (Қазақша)', 'text'],
                            ['name_en', 'name (English)', 'text'],
                            [
                              'category',
                              'allCategories',
                              'select',
                              ['dairy', 'grocery', 'vegetables', 'other'].map((k) => [k, t(k)]),
                            ],
                            ['brand', 'brand', 'text'],
                            ['manufacturer', 'manufacturer', 'text'],
                            ['quantity', 'quantity', 'number'],
                            ['unit', 'unit', 'select', ['kg', 'l', 'pcs'].map((k) => [k, t(k)])],
                            ['packaging', 'packaging', 'select', ['pack', 'loose'].map((k) => [k, t(k)])],
                            ['barcode', 'barcode', 'optional'],
                            ['fat', 'fat', 'optionalNumber'],
                            ['family', 'family', 'text'],
                          ];
                    return fields.map(([key, label, type, options]: any) => (
                      <label key={key}>
                        {label.includes('(') ? label.replace('name', t('name')) : t(label)}
                        {type === 'select' ? (
                          <select
                            value={v[key] ?? ''}
                            required
                            onChange={(e) => setModal({ ...modal, values: { ...v, [key]: e.target.value } })}
                          >
                            {options.map(([id, labelOpt]: any) => (
                              <option key={id} value={id}>
                                {labelOpt}
                              </option>
                            ))}
                          </select>
                        ) : type === 'checkbox' ? (
                          <input
                            type="checkbox"
                            checked={!!v[key]}
                            onChange={(e) => setModal({ ...modal, values: { ...v, [key]: e.target.checked } })}
                          />
                        ) : (
                          <input
                            required={!type.startsWith('optional')}
                            type={type === 'optional' ? 'text' : type === 'optionalNumber' ? 'number' : type}
                            step={type === 'datetime-local' ? 1 : 'any'}
                            min={type === 'number' ? '0.001' : undefined}
                            value={v[key] ?? ''}
                            maxLength={500}
                            onChange={(e) => setModal({ ...modal, values: { ...v, [key]: e.target.value } })}
                          />
                        )}
                      </label>
                    ));
                  })()}
                </div>
                {modal.kind === 'prices' && Number(modal.values.amount) > 0 && (() => {
                  const selP = data.products.find((p: any) => p.id === modal.values.product_id);
                  if (!selP) return null;
                  const norm = Math.round((Number(modal.values.amount) / selP.quantity) * 100) / 100;
                  return (
                    <p className="sp-section-note" style={{ marginTop: 0 }}>
                      <Scale size={13} style={{ display: 'inline', marginRight: 5 }} />
                      {t('normalized')}: <b>{money(norm)} / {t(selP.unit)}</b> ({selP.quantity} {t(selP.unit)})
                    </p>
                  );
                })()}
                <div className="sp-modal-actions">
                  <button type="button" className="sp-btn" onClick={() => setModal(null)}>
                    {t('cancel')}
                  </button>
                  <button type="submit" className="sp-btn primary" disabled={busy}>
                    {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {t('save')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RegionalStats({ data, latest, lang, onSelect, productId }: any) {
  const t = (k: string) => tr(k, lang);
  const compareId = productId || data.products?.[0]?.id || 'oil';
  const prod = data.products?.find((p: any) => p.id === compareId);
  const groups = useMemo(
    () => computeRegionalProductStats(latest, data.regions || [], compareId),
    [latest, data.regions, compareId]
  );

  return (
    <section className="sp-card">
      <div className="sp-card-head">
        <div>
          <h3>
            {t('regionStats')} — {productName(prod, lang)} ({prod?.quantity} {t(prod?.unit)})
          </h3>
        </div>
      </div>
      <div className="sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr>
              {['region', 'totalStores', 'cheap', 'medianPrice', 'expensive', 'spreadPct', 'delta'].map((k) => (
                <th key={k}>{t(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((row: any) => (
              <tr key={row.region.id} onClick={() => onSelect(row.region.id)}>
                <td>
                  <strong>{regionName(row.region, lang)}</strong>
                </td>
                <td>{row.stores}</td>
                <td style={{ color: '#209b85', fontWeight: 600 }}>
                  {money(row.min)} / {t(prod?.unit)}
                  <small>{row.minItem?.store_name}</small>
                </td>
                <td className="sp-price">
                  {money(row.median)} / {t(prod?.unit)}
                </td>
                <td style={{ color: '#c76d66', fontWeight: 600 }}>
                  {money(row.max)} / {t(prod?.unit)}
                  <small>{row.maxItem?.store_name}</small>
                </td>
                <td>{row.spreadPct}%</td>
                <td>
                  <Delta value={row.avgDelta} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
