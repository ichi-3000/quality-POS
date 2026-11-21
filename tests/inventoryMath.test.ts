import { describe, expect, it } from 'vitest';
import {
  computeGrandTotal,
  computeLineTotal,
  computeShortfall,
  computeStockStatus,
  computeStockValue,
  computeSuggestedReplenishment,
  formatUGX,
} from '../server/services/inventoryMath.ts';

describe('Inventory Math Unit Tests', () => {
  it('computes accurate stock statuses based on quantity and reorder level', () => {
    expect(computeStockStatus(0, 15)).toBe('out_of_stock');
    expect(computeStockStatus(10, 15)).toBe('low_stock');
    expect(computeStockStatus(15, 15)).toBe('low_stock');
    expect(computeStockStatus(16, 15)).toBe('in_stock');
  });

  it('calculates shortfall accurately without negative values', () => {
    expect(computeShortfall(0, 20)).toBe(20);
    expect(computeShortfall(12, 20)).toBe(8);
    expect(computeShortfall(20, 20)).toBe(0);
    expect(computeShortfall(35, 20)).toBe(0);
  });

  it('calculates suggested replenishment quantity when at or below reorder level', () => {
    expect(computeSuggestedReplenishment(5, 20, 2)).toBe(35);
    expect(computeSuggestedReplenishment(0, 15, 2)).toBe(30);
    expect(computeSuggestedReplenishment(25, 20, 2)).toBe(0);
  });

  it('computes exact integer UGX line totals, grand totals, and stock valuation', () => {
    const line1 = computeLineTotal(12, 9500);
    const line2 = computeLineTotal(5, 34000);
    expect(line1).toBe(114000);
    expect(line2).toBe(170000);
    expect(computeGrandTotal([line1, line2])).toBe(284000);
    expect(computeStockValue(40, 24500)).toBe(980000);
    expect(formatUGX(250000)).toBe('UGX 250,000');
  });
});
