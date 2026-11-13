'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Lang } from '@/lib/smartprice/i18n';

type Row = { store: string; city: string; amount: number };
type Snapshot = {
  publisher: string;
  source_url: string;
  observed_at: string;
  retrieved_date: string;
  product: { name: string; quantity: number; unit: string; match_note: string; match_note_kk: string };
  methodology: string;
  methodology_kk: string;
  photo_evidence: boolean;
  currency: string;
  rows: Row[];
};

const copy = {
  ru: {
    title: 'Внешний срез онлайн-цен', subtitle: 'Один продукт в нескольких сетях и городах', loading: 'Загружаем…',
    city: 'Город', all: 'Все города', observed: 'Дата цен', collected: 'Загружено в проект', count: 'Цен', min: 'Минимум', median: 'Медиана', max: 'Максимум',
    store: 'Сеть', amount: 'Цена, ₸', unit: 'Ед.', source: 'Источник и методика',
    caveat: 'Вторичный набор цен из публикации Redstat. Smart Price не собирал и не проверял эти цены; фото ценников и GTIN в источнике не приведены. Набор отделён от наблюдений приложения.',
    error: 'Не удалось загрузить набор цен.',
  },
  kk: {
    title: 'Сыртқы онлайн-баға дерегі', subtitle: 'Бір өнімнің бірнеше желі мен қаладағы бағасы', loading: 'Жүктелуде…',
    city: 'Қала', all: 'Барлық қала', observed: 'Баға күні', collected: 'Жобаға жүктелді', count: 'Баға', min: 'Ең төмен', median: 'Медиана', max: 'Ең жоғары',
    store: 'Желі', amount: 'Бағасы, ₸', unit: 'Өлшем', source: 'Дереккөз және әдістеме',
    caveat: 'Redstat жариялаған екінші реттік онлайн-дерек. Бағаларды Smart Price жинамаған және тексермеген; сөре фотолары мен GTIN жарияланбаған. Бұл дерек қолданба бақылауларынан бөлек көрсетіледі.',
    error: 'Баға дерегін жүктеу мүмкін болмады.',
  },
  en: {
    title: 'External online price snapshot', subtitle: 'One product across multiple retailers and cities', loading: 'Loading…',
    city: 'City', all: 'All cities', observed: 'Price date', collected: 'Added to project', count: 'Prices', min: 'Minimum', median: 'Median', max: 'Maximum',
    store: 'Retailer', amount: 'Price, ₸', unit: 'Unit', source: 'Source and methodology',
    caveat: 'Secondary online data published by Redstat. Smart Price did not collect or verify these prices; shelf photos and GTIN are not provided. This dataset is kept separate from app observations.',
    error: 'Could not load the price dataset.',
  },
} as const;

export default function RetailSnapshot({ lang }: { lang: Lang }) {
  const text = copy[lang];
  const locale = lang === 'kk' ? 'kk-KZ' : lang === 'en' ? 'en-US' : 'ru-RU';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/smartprice/sources/retail-lactel-2026-11-02.json', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(text.error);
        return response.json();
      })
      .then((data: Snapshot) => { if (active) setSnapshot(data); })
      .catch(() => { if (active) setError(text.error); });
    return () => { active = false; };
  }, [text.error]);

  const cities = useMemo(
    () => snapshot ? [...new Set(snapshot.rows.map((row) => row.city))].sort((a, b) => a.localeCompare(b, locale)) : [],
    [snapshot, locale],
  );
  const rows = useMemo(
    () => snapshot ? snapshot.rows.filter((row) => !city || row.city === city).sort((a, b) => a.amount - b.amount) : [],
    [snapshot, city],
  );
  const stats = useMemo(() => {
    const amounts = rows.map((row) => row.amount).sort((a, b) => a - b);
    if (!amounts.length) return null;
    const middle = Math.floor(amounts.length / 2);
    return {
      min: amounts[0],
      median: amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2,
      max: amounts[amounts.length - 1],
    };
  }, [rows]);
  const money = (value: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ₸`;

  return (
    <section className="sp-card">
      <div className="sp-card-head">
        <div><h3>{text.title}</h3><p>{text.subtitle}</p></div>
        <a href={snapshot?.source_url || 'https://redstat.kz/analytics/foodmaster'} target="_blank" rel="noreferrer">
          {text.source} ↗
        </a>
      </div>
      {error && <p className="sp-section-note" role="alert">{error}</p>}
      {!snapshot && !error && <p className="sp-section-note" role="status">{text.loading}</p>}
      {snapshot && (
        <>
          <div className="sp-period-strip">
            <div><small>{lang === 'kk' ? 'Өнім' : lang === 'en' ? 'Product' : 'Товар'}</small><strong>{snapshot.product.name} · {snapshot.product.quantity} {snapshot.product.unit}</strong></div>
            <div><small>{text.observed}</small><strong>{snapshot.observed_at}</strong></div>
            <div><small>{text.collected}</small><strong>{snapshot.retrieved_date}</strong></div>
          </div>
          <div className="sp-table-tools">
            <label className="sp-field-label">{text.city}
              <select value={city} onChange={(event) => setCity(event.target.value)}>
                <option value="">{text.all}</option>
                {cities.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            {stats && <div className="sp-preview-summary">
              <span className="sp-chip">{rows.length} {text.count}</span>
              <span className="sp-chip">{text.min}: {money(stats.min)}</span>
              <span className="sp-chip">{text.median}: {money(stats.median)}</span>
              <span className="sp-chip">{text.max}: {money(stats.max)}</span>
            </div>}
          </div>
          <div className="sp-table-wrap">
            <table className="sp-table">
              <thead><tr><th>{text.store}</th><th>{text.city}</th><th>{text.amount}</th><th>{text.unit}</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr key={`${row.store}-${row.city}-${index}`}>
                <td>{row.store}</td><td>{row.city}</td><td>{money(row.amount)}</td><td>{snapshot.product.unit}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="sp-section-note">{snapshot.methodology_kk && lang === 'kk' ? snapshot.methodology_kk : snapshot.methodology}</p>
          <p className="sp-section-note">{text.caveat}</p>
          <p className="sp-section-note">{snapshot.product.match_note_kk && lang === 'kk' ? snapshot.product.match_note_kk : snapshot.product.match_note}</p>
        </>
      )}
    </section>
  );
}
