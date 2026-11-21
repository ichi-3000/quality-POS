export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export function computeStockStatus(quantityOnHand: number, reorderLevel: number): StockStatus {
  if (quantityOnHand <= 0) {
    return 'out_of_stock';
  }
  if (quantityOnHand <= reorderLevel) {
    return 'low_stock';
  }
  return 'in_stock';
}

export function computeShortfall(quantityOnHand: number, reorderLevel: number): number {
  if (quantityOnHand >= reorderLevel) {
    return 0;
  }
  return Math.max(0, reorderLevel - Math.max(0, quantityOnHand));
}

export function computeSuggestedReplenishment(
  quantityOnHand: number,
  reorderLevel: number,
  targetMultiplier = 2
): number {
  if (quantityOnHand > reorderLevel) {
    return 0;
  }
  const targetStock = Math.max(reorderLevel * targetMultiplier, reorderLevel + 10);
  return Math.max(0, targetStock - Math.max(0, quantityOnHand));
}

export function computeLineTotal(quantity: number, unitCost: number): number {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error('Quantity must be a non-negative integer');
  }
  const safeCost = Math.round(unitCost);
  if (safeCost < 0) {
    throw new Error('Unit cost must be non-negative');
  }
  return quantity * safeCost;
}

export function computeGrandTotal(lineTotals: number[]): number {
  return lineTotals.reduce((sum, val) => sum + Math.round(val), 0);
}

export function computeStockValue(quantityOnHand: number, unitCost: number): number {
  return Math.max(0, quantityOnHand) * Math.max(0, Math.round(unitCost));
}

export function formatUGX(amount: number): string {
  const rounded = Math.round(amount || 0);
  return `UGX ${rounded.toLocaleString('en-UG')}`;
}
