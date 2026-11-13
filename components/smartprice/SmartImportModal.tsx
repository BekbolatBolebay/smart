'use client';
import React, { useRef, useState } from 'react';
import { Upload, Download, Sparkles, Check, AlertTriangle, XCircle, Loader2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { Lang, tr, errorText, productName } from '@/lib/smartprice/i18n';
import { formatCurrency } from '@/lib/utils';

const money = (n: number) => formatCurrency(Math.round(n || 0));

export default function SmartImportModal({
  data,
  lang,
  onImported,
  onClose,
}: {
  data: any;
  lang: Lang;
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const t = (k: string) => tr(k, lang);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'file' | 'ai'>('file');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [parseMeta, setParseMeta] = useState<{ mode: string; model: string } | null>(null);
  const [rawText, setRawText] = useState(
    'Сүт 2.5% 900 мл 450 тг\nКүнбағыс майы 1л 1080\nҚант 1кг 445 тг\nКартоп 1кг -50'
  );
  const [storeId, setStoreId] = useState(data.stores?.find((s: any) => s.monitoring)?.id || 'store-0');

  function downloadTemplate() {
    const blob = new Blob(
      ['product_id,store_id,amount,collected_at,source\r\noil,store-0,1100,' + new Date().toISOString() + ',manual\r\n'],
      { type: 'text/csv;charset=utf-8' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'smart-price-import.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  async function handleFilePreview(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/smartprice/import-preview', { method: 'POST', body: form });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error);
      setPreview(res.items || []);
      setParseMeta(null);
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }

  async function handleAiParse() {
    if (!rawText.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/smartprice/ai/parse-rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, storeId, lang }),
      });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error);
      setPreview(res.items || []);
      setParseMeta({ mode: res.mode, model: res.model });
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    } finally {
      setBusy(false);
    }
  }

  async function commitValidRows() {
    if (!preview) return;
    const validRows = preview
      .filter((it) => it.status === 'valid' || it.status === 'duplicate_day')
      .map((it) => it.row);
    if (!validRows.length) return;
    setBusy(true);
    try {
      const r = await fetch('/api/smartprice/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows }),
      });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error);
      toast.success(`${t('imported')}: ${res.items.length}`);
      await onImported();
      onClose();
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    } finally {
      setBusy(false);
    }
  }

  const validList = preview?.filter((x) => x.status === 'valid' || x.status === 'duplicate_day') || [];
  const dupList = preview?.filter((x) => x.status === 'duplicate_exact' || x.status === 'duplicate_day') || [];
  const errList = preview?.filter((x) => x.status === 'error') || [];

  return (
    <div className="sp-import-dialog">
      <div className="sp-tabs">
        <button type="button" className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>
          <FileSpreadsheet size={15} />
          {t('previewFileTab')}
        </button>
        <button type="button" className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}>
          <Sparkles size={15} />
          {t('previewTextTab')}
        </button>
      </div>

      {tab === 'file' ? (
        <>
          <p>{t('importGuide')}</p>
          <code>product_id,store_id,amount,collected_at,source</code>
          <div className="sp-inline-actions">
            <button type="button" className="sp-btn" onClick={downloadTemplate}>
              <Download size={15} />
              {t('template')}
            </button>
            <button
              type="button"
              className="sp-btn primary"
              disabled={busy}
              onClick={() => uploadRef.current?.click()}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
              {t('import')}
            </button>
          </div>
          <input
            hidden
            ref={uploadRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => handleFilePreview(e.target.files?.[0])}
          />
          <p className="sp-section-note">
            {t('product')}: {data.products.map((p: any) => p.id).join(', ')}
            <br />
            {t('store')}: {data.stores.slice(0, 4).map((s: any) => s.id).join(', ')}…
          </p>
        </>
      ) : (
        <div className="sp-ai-import-box">
          <label className="sp-field-label">
            {t('store')}
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {data.stores
                .filter((s: any) => s.monitoring)
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={4}
            placeholder={t('aiRawPlaceholder')}
          />
          <button type="button" className="sp-btn primary" disabled={busy || !rawText.trim()} onClick={handleAiParse}>
            {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {t('parseTextBtn')}
          </button>
        </div>
      )}

      {preview && (
        <div className="sp-preview-wrap">
          <div className="sp-preview-summary">
            <span className="sp-stamp verified">
              <i />
              {t('validCount')}: {validList.length}
            </span>
            <span className="sp-stamp pending">
              <i />
              {t('dupCount')}: {dupList.length}
            </span>
            <span className="sp-stamp rejected">
              <i />
              {t('errCount')}: {errList.length}
            </span>
            {parseMeta && <span className="sp-chip">{parseMeta.model}</span>}
          </div>

          <div className="sp-table-wrap" style={{ maxHeight: 230, overflowY: 'auto' }}>
            <table className="sp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('product')}</th>
                  <th>{t('price')}</th>
                  <th>{t('normalized')}</th>
                  <th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.line}</td>
                    <td>
                      {item.productName || item.row?.product_id || '—'}
                      {item.row?.raw_line && <small>{item.row.raw_line}</small>}
                    </td>
                    <td className="sp-price">{item.row?.amount ?? '—'}</td>
                    <td>{item.normalized != null ? `${money(item.normalized)} / ${t(item.unit)}` : '—'}</td>
                    <td>
                      {item.status === 'valid' && (
                        <span className="sp-stamp verified">
                          <Check size={11} />
                          OK {item.analysis?.anomaly ? `(${item.analysis.delta}%)` : ''}
                        </span>
                      )}
                      {item.status === 'duplicate_day' && (
                        <span className="sp-stamp pending">
                          <AlertTriangle size={11} />
                          {t('duplicate_day')}
                        </span>
                      )}
                      {(item.status === 'duplicate_exact' || item.status === 'error') && (
                        <span className="sp-stamp rejected">
                          <XCircle size={11} />
                          {tr(item.errorCode || 'invalid', lang)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sp-modal-actions" style={{ padding: '14px 0 0', background: 'none', borderTop: 0 }}>
            <button type="button" className="sp-btn" onClick={() => setPreview(null)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className="sp-btn primary"
              disabled={busy || validList.length === 0}
              onClick={commitValidRows}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              {t('importValidBtn')} ({validList.length})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

