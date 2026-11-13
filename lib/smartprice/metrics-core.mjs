export function latestPrices(prices) {
  const found = new Set();
  return [...prices]
    .sort((a, b) => b.collected_at.localeCompare(a.collected_at))
    .filter((p) => {
      const key = p.product_id + '|' + p.store_id;
      if (found.has(key) || p.status === 'rejected') return false;
      found.add(key);
      return true;
    });
}

export function baskets(prices, products) {
  const days = {};
  for (const p of prices) {
    if (p.status === 'rejected') continue;
    const day = p.collected_at.slice(0, 10);
    (days[day] ||= []).push(p);
  }
  const families = Array.from(new Set(products.map((p) => p.family)));
  let carried = [];
  return Object.entries(days)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, ps]) => {
      carried = latestPrices([...ps, ...carried]);
      const averages = families.map((f) => {
        const group = carried.filter((p) => p.family === f);
        return group.length ? group.reduce((s, p) => s + p.normalized, 0) / group.length : null;
      });
      return {
        day,
        value:
          averages.length && averages.every((v) => v !== null)
            ? Math.round(averages.reduce((s, v) => s + (v || 0), 0))
            : null,
      };
    });
}

function medianOfSorted(sorted) {
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export function computeRobustStats(values) {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!clean.length) return null;
  const count = clean.length;
  const min = clean[0];
  const max = clean[count - 1];
  const median = medianOfSorted(clean);
  const lower = clean.slice(0, Math.floor(count / 2));
  const upper = clean.slice(Math.ceil(count / 2));
  const q1 = lower.length ? medianOfSorted(lower) : min;
  const q3 = upper.length ? medianOfSorted(upper) : max;
  const iqr = Math.round((q3 - q1) * 100) / 100;
  const absDevs = clean.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = medianOfSorted(absDevs) || 0;
  const mean = Math.round((clean.reduce((s, v) => s + v, 0) / count) * 100) / 100;
  const variance = clean.reduce((s, v) => s + (v - mean) ** 2, 0) / count;
  const stdDev = Math.round(Math.sqrt(variance) * 100) / 100;
  return {
    count,
    min: Math.round(min * 100) / 100,
    q1: Math.round(q1 * 100) / 100,
    median: Math.round(median * 100) / 100,
    q3: Math.round(q3 * 100) / 100,
    max: Math.round(max * 100) / 100,
    mean,
    iqr,
    mad: Math.round(mad * 100) / 100,
    stdDev,
    spreadPct: median > 0 ? Math.round(((max - min) / median) * 1000) / 10 : 0,
  };
}

export function computeMinMedianMax(items, key = 'normalized') {
  const valid = items.filter((it) => Number.isFinite(Number(it[key])) && Number(it[key]) > 0);
  if (!valid.length) return null;
  const sortedItems = [...valid].sort((a, b) => Number(a[key]) - Number(b[key]));
  const stats = computeRobustStats(sortedItems.map((x) => Number(x[key])));
  return {
    ...stats,
    minItem: sortedItems[0],
    maxItem: sortedItems[sortedItems.length - 1],
  };
}

export function computeRegionalProductStats(latest, regions, productId) {
  const scoped = productId ? latest.filter((p) => p.product_id === productId) : latest;
  return regions
    .map((r) => {
      const rp = scoped.filter((p) => p.region === r.id);
      if (!rp.length) return null;
      const stats = computeMinMedianMax(rp, 'normalized');
      const avgDelta = Math.round((rp.reduce((s, p) => s + (p.delta || 0), 0) / rp.length) * 100) / 100;
      return {
        region: r,
        stores: new Set(rp.map((p) => p.store_id)).size,
        count: rp.length,
        avgDelta,
        ...stats,
      };
    })
    .filter(Boolean);
}

export function computeProductSummaryTable(latest, products) {
  return products
    .map((product) => {
      const items = latest.filter((p) => p.product_id === product.id);
      const stats = computeMinMedianMax(items, 'normalized');
      if (!stats) return null;
      const avgDelta = Math.round((items.reduce((s, p) => s + (p.delta || 0), 0) / items.length) * 100) / 100;
      return {
        product,
        ...stats,
        avgDelta,
      };
    })
    .filter(Boolean);
}

export function computePeriodComparison(scopedPrices, productId) {
  const filtered = scopedPrices.filter((p) => p.status !== 'rejected' && (!productId || p.product_id === productId));
  if (!filtered.length) return null;
  const days = Array.from(new Set(filtered.map((p) => p.collected_at.slice(0, 10)))).sort();
  if (days.length < 2) return null;
  const split = Math.floor(days.length / 2);
  const earlyDays = new Set(days.slice(0, split));
  const lateDays = new Set(days.slice(split));
  const early = computeMinMedianMax(
    filtered.filter((p) => earlyDays.has(p.collected_at.slice(0, 10))),
    'normalized'
  );
  const late = computeMinMedianMax(
    filtered.filter((p) => lateDays.has(p.collected_at.slice(0, 10))),
    'normalized'
  );
  if (!early || !late) return null;
  const medianDeltaPct = early.median > 0 ? Math.round(((late.median - early.median) / early.median) * 10000) / 100 : 0;
  return {
    earlyFrom: days[0],
    earlyTo: days[split - 1],
    lateFrom: days[split],
    lateTo: days[days.length - 1],
    early,
    late,
    medianDeltaPct,
  };
}

export function forecastSeries(points, horizon = 7, valueKey = 'value') {
  const valid = points.filter((p) => p[valueKey] != null && Number.isFinite(Number(p[valueKey])));
  if (valid.length < 3) {
    return {
      series: points.map((p) => ({ ...p, forecast: null, upper95: null, lower95: null, isForecast: false })),
      summary: null,
    };
  }

  const ys = valid.map((p) => Number(p[valueKey]));
  const alpha = 0.42;
  const beta = 0.18;
  const phi = 0.88;

  let level = ys[0];
  let trend = ys[1] - ys[0];
  const fitted = [ys[0]];
  const residuals = [];

  for (let i = 1; i < ys.length; i++) {
    const pred = level + phi * trend;
    const err = ys[i] - pred;
    residuals.push(err);
    const nextLevel = alpha * ys[i] + (1 - alpha) * (level + phi * trend);
    const nextTrend = beta * (nextLevel - level) + (1 - beta) * phi * trend;
    level = nextLevel;
    trend = nextTrend;
    fitted.push(pred);
  }

  const rmse = residuals.length
    ? Math.sqrt(residuals.reduce((s, e) => s + e * e, 0) / residuals.length)
    : Math.max(1, level * 0.015);
  const sigma = Math.max(rmse, level * 0.006);

  const lastValidDay = valid[valid.length - 1].day;
  const lastDate = new Date(lastValidDay.slice(0, 10) + 'T00:00:00Z');
  const lastVal = ys[ys.length - 1];

  const baseSeries = points.map((p, idx) => ({
    ...p,
    forecast: idx === points.length - 1 ? lastVal : null,
    upper95: idx === points.length - 1 ? lastVal : null,
    lower95: idx === points.length - 1 ? lastVal : null,
    isForecast: false,
  }));

  const future = [];
  let phiSum = 0;
  for (let h = 1; h <= horizon; h++) {
    phiSum += Math.pow(phi, h);
    const fVal = Math.max(1, Math.round(level + phiSum * trend));
    const margin = Math.round(1.96 * sigma * Math.sqrt(h));
    const d = new Date(lastDate);
    d.setUTCDate(d.getUTCDate() + h);
    future.push({
      day: d.toISOString().slice(0, 10),
      [valueKey]: null,
      forecast: fVal,
      upper95: fVal + margin,
      lower95: Math.max(1, fVal - margin),
      isForecast: true,
    });
  }

  const endVal = future[future.length - 1].forecast;
  const changePct = lastVal > 0 ? Math.round(((endVal - lastVal) / lastVal) * 10000) / 100 : 0;

  return {
    series: [...baseSeries, ...future],
    summary: {
      lastValue: Math.round(lastVal),
      forecastEnd: endVal,
      changePct,
      slopePerDay: Math.round(trend * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
      horizon,
    },
  };
}

export function detectShrinkflation(products, latest) {
  const byFamilyUnit = new Map();
  for (const p of products) {
    const key = `${p.family}|${p.unit}`;
    if (!byFamilyUnit.has(key)) byFamilyUnit.set(key, []);
    byFamilyUnit.get(key).push(p);
  }

  const pairs = [];
  for (const group of byFamilyUnit.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.quantity - b.quantity);
    const small = sorted[0];
    const large = sorted[sorted.length - 1];
    if (small.quantity === large.quantity) continue;
    const smallPrices = latest.filter((x) => x.product_id === small.id);
    const largePrices = latest.filter((x) => x.product_id === large.id);
    if (!smallPrices.length || !largePrices.length) continue;
    const smallUnitAvg = smallPrices.reduce((s, x) => s + x.normalized, 0) / smallPrices.length;
    const largeUnitAvg = largePrices.reduce((s, x) => s + x.normalized, 0) / largePrices.length;
    const smallShelfAvg = smallPrices.reduce((s, x) => s + x.amount, 0) / smallPrices.length;
    const largeShelfAvg = largePrices.reduce((s, x) => s + x.amount, 0) / largePrices.length;
    const hiddenPremiumPct = largeUnitAvg > 0 ? Math.round(((smallUnitAvg - largeUnitAvg) / largeUnitAvg) * 10000) / 100 : 0;
    pairs.push({
      family: small.family,
      unit: small.unit,
      small,
      large,
      smallShelfAvg: Math.round(smallShelfAvg),
      largeShelfAvg: Math.round(largeShelfAvg),
      smallUnitAvg: Math.round(smallUnitAvg),
      largeUnitAvg: Math.round(largeUnitAvg),
      hiddenPremiumPct,
      sizeRatioPct: Math.round((small.quantity / large.quantity) * 1000) / 10,
    });
  }

  const nonUnitPackages = products
    .filter((p) => p.quantity !== 1 && !(p.unit === 'pcs' && p.quantity === 10))
    .map((p) => {
      const items = latest.filter((x) => x.product_id === p.id);
      if (!items.length) return null;
      const shelfAvg = Math.round(items.reduce((s, x) => s + x.amount, 0) / items.length);
      const unitAvg = Math.round(items.reduce((s, x) => s + x.normalized, 0) / items.length);
      return {
        product: p,
        shelfAvg,
        unitAvg,
      };
    })
    .filter(Boolean);

  return { pairs, nonUnitPackages };
}

