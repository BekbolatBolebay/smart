import {
  latestPrices as _latestPrices,
  baskets as _baskets,
  computeRobustStats as _computeRobustStats,
  computeMinMedianMax as _computeMinMedianMax,
  computeRegionalProductStats as _computeRegionalProductStats,
  computeProductSummaryTable as _computeProductSummaryTable,
  computePeriodComparison as _computePeriodComparison,
  forecastSeries as _forecastSeries,
  detectShrinkflation as _detectShrinkflation,
} from './metrics-core.mjs';

export const latestPrices = (prices: any[]) => _latestPrices(prices);
export const baskets = (prices: any[], products: any[]) => _baskets(prices, products);
export const computeRobustStats = (values: number[]) => _computeRobustStats(values);
export const computeMinMedianMax = (items: any[], key = 'normalized') => _computeMinMedianMax(items, key);
export const computeRegionalProductStats = (latest: any[], regions: any[], productId: string) =>
  _computeRegionalProductStats(latest, regions, productId);
export const computeProductSummaryTable = (latest: any[], products: any[]) =>
  _computeProductSummaryTable(latest, products);
export const computePeriodComparison = (scopedPrices: any[], productId = '') =>
  _computePeriodComparison(scopedPrices, productId);
export const forecastSeries = (points: any[], horizon = 7, valueKey = 'value') =>
  _forecastSeries(points, horizon, valueKey);
export const detectShrinkflation = (products: any[], latest: any[]) =>
  _detectShrinkflation(products, latest);
