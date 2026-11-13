'use client';
import React, { useRef, useState } from 'react';
import { Camera, Sparkles, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Lang, tr, errorText, productName } from '@/lib/smartprice/i18n';
import { formatCurrency } from '@/lib/utils';

const money = (n: number) => formatCurrency(Math.round(n || 0));

export default function PriceTagScanner({
  products,
  lang,
  onApply,
}: {
  products: any[];
  lang: Lang;
  onApply: (patch: { product_id?: string; amount?: string; source?: string }) => void;
}) {
  const t = (k: string) => tr(k, lang);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rawText, setRawText] = useState('');
  const [result, setResult] = useState<any>(null);

  async function runOcr(payload: { imageBase64?: string; mime?: string; rawText?: string }) {
    setBusy(true);
    try {
      const r = await fetch('/api/smartprice/ai/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, lang }),
      });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error);
      setResult(res);
      if (res.productId || res.amount) {
        onApply({
          ...(res.productId ? { product_id: res.productId } : {}),
          ...(res.amount ? { amount: String(res.amount) } : {}),
          source: 'photo',
        });
      }
      toast.success(t('aiExtracted'));
    } catch (e: any) {
      toast.error(errorText(e.message, lang));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('imageLimit'));
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(file);
    });
    await runOcr({ imageBase64: base64, mime: file.type || 'image/png' });
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSamplePriceTag() {
    // Render a real price tag PNG on canvas so Tesseract OCR + LLM runs end-to-end on real image bytes
    const canvas = document.createElement('canvas');
    canvas.width = 560;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#193a56';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.fillStyle = '#193a56';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.fillText('МОЛОКО 2.5% 900 МЛ', 30, 68);
    ctx.font = 'bold 46px Arial, sans-serif';
    ctx.fillStyle = '#1b887d';
    ctx.fillText('ЦЕНА: 450 ТГ', 30, 140);
    ctx.font = '20px Arial, sans-serif';
    ctx.fillStyle = '#4a5d70';
    ctx.fillText('Бренд: DEMO Kazakhstan · 0.9 л', 30, 195);
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    await runOcr({ imageBase64: base64, mime: 'image/png' });
  }

  const matchedProd = products.find((p) => p.id === result?.productId);

  return (
    <div className="sp-ocr-box">
      <div className="sp-ocr-head">
        <strong>
          <Sparkles size={14} />
          {t('aiScanTitle')}
        </strong>
        <div className="sp-inline-actions">
          <button type="button" className="sp-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}
            {t('upload')}
          </button>
          <button type="button" className="sp-btn" disabled={busy} onClick={handleSamplePriceTag}>
            <Sparkles size={14} />
            {t('aiSampleTag')}
          </button>
        </div>
      </div>

      <input
        hidden
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <div className="sp-ocr-text-row">
        <input
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={t('aiRawPlaceholder')}
        />
        <button
          type="button"
          className="sp-btn"
          disabled={busy || !rawText.trim()}
          onClick={() => runOcr({ rawText })}
        >
          {t('aiScanBtn')}
        </button>
      </div>

      {result && (
        <div className="sp-ocr-result">
          <div>
            <span className="sp-chip">{result.model}</span>
            <strong>
              {matchedProd ? productName(matchedProd, lang) : result.detectedName || '—'} ·{' '}
              {result.amount ? money(result.amount) : '—'}
            </strong>
            {result.normalizedPerUnit != null && (
              <small>
                {t('normalized')}: <b>{money(result.normalizedPerUnit)} / {t(result.unit)}</b> · {t('confidence')}:{' '}
                {result.confidence}%
              </small>
            )}
            {result.rawOcrText && <small>OCR: {result.rawOcrText.replace(/\s+/g, ' ').slice(0, 120)}</small>}
          </div>
          <Check size={16} color="#1b887d" />
        </div>
      )}
    </div>
  );
}

