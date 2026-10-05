import { priceLine, priceOrder, proportionalRefund, toCents } from '@mizmar/shared';

const incl = (o: Partial<Parameters<typeof priceLine>[0]> = {}) => priceLine({ quantity: 1, unitPrice: 120, taxRatePct: 20, taxInclusive: true, ...o });

describe('priceLine: tax-inclusive (the retail default)', () => {
  it('120 incl. 20% VAT = 100 net of tax + 20 tax; the customer pays 120', () => {
    expect(incl()).toEqual({ gross: 120, discount: 0, net: 120, tax: 20, total: 120 });
  });
  it('percent discount is taken off the price the customer sees, and tax follows the discounted amount', () => {
    expect(incl({ discount: { type: 'PERCENT', value: 10 } })).toEqual({ gross: 120, discount: 12, net: 108, tax: 18, total: 108 });
  });
  it('fixed amount discount', () => expect(incl({ discount: { type: 'AMOUNT', value: 20 } })).toMatchObject({ discount: 20, net: 100, tax: 16.67, total: 100 }));
  it('quantity multiplies the price (and the lens + treatments add to it, per unit)', () => {
    const l = incl({ quantity: 2, unitPrice: 1000, lensPrice: 400, treatmentsPrice: 150 });
    expect(l).toMatchObject({ gross: 3100, total: 3100 });
  });
  it('0% VAT items carry no tax', () => expect(incl({ taxRatePct: 0 })).toMatchObject({ tax: 0, total: 120 }));
});

describe('priceLine: tax-exclusive', () => {
  it('tax is added on top: 100 + 20% = 120', () => {
    expect(incl({ unitPrice: 100, taxInclusive: false })).toEqual({ gross: 100, discount: 0, net: 100, tax: 20, total: 120 });
  });
  it('discount applies before tax', () => {
    expect(incl({ unitPrice: 100, taxInclusive: false, discount: { type: 'PERCENT', value: 50 } })).toMatchObject({ net: 50, tax: 10, total: 60 });
  });
});

describe('priceLine: safety', () => {
  it('a discount can never exceed the line (no negative lines)', () => {
    expect(incl({ discount: { type: 'AMOUNT', value: 9999 } })).toMatchObject({ discount: 120, net: 0, tax: 0, total: 0 });
  });
  it('rounds half up in cents and never produces float noise', () => {
    // 0.1 + 0.2 style traps
    expect(incl({ unitPrice: 0.1, quantity: 3, taxRatePct: 0 }).total).toBe(0.3);
    expect(incl({ unitPrice: 19.99, quantity: 3, taxRatePct: 0 }).total).toBe(59.97);
    expect(incl({ unitPrice: 10.005, taxRatePct: 0 }).total).toBe(10.01);
    expect(incl({ unitPrice: 99.99, discount: { type: 'PERCENT', value: 33.333 }, taxRatePct: 0 }).discount).toBe(33.33);
  });
  it.each([
    [{ quantity: 0 }], [{ quantity: 1.5 }], [{ taxRatePct: -1 }], [{ taxRatePct: 101 }], [{ unitPrice: -5 }],
    [{ discount: { type: 'PERCENT' as const, value: 101 } }], [{ discount: { type: 'AMOUNT' as const, value: -1 } }],
  ])('rejects invalid input %j', (bad) => expect(() => incl(bad as never)).toThrow(RangeError));
});

describe('priceOrder', () => {
  const lines = [
    { quantity: 1, unitPrice: 1450, lensPrice: 800, treatmentsPrice: 350, taxRatePct: 20, taxInclusive: true, discount: { type: 'PERCENT' as const, value: 10 } as const },
    { quantity: 2, unitPrice: 49.9, taxRatePct: 20, taxInclusive: true },
    { quantity: 1, unitPrice: 280, taxRatePct: 10, taxInclusive: true },
  ];
  it('the order total is exactly the sum of the line totals (so invoice lines always add up)', () => {
    const o = priceOrder(lines);
    expect(o.lines.map((l) => l.total)).toEqual([2340, 99.8, 280]);
    expect(o.total).toBe(2719.8);
    expect(o.subtotal).toBe(2600 + 99.8 + 280);
    expect(o.discountTotal).toBe(260);
    expect(toCents(o.total)).toBe(o.lines.reduce((n, l) => n + toCents(l.total), 0));
    expect(o.taxTotal).toBe(o.lines.reduce((n, l) => n + l.tax, 0) && Math.round(o.lines.reduce((n, l) => n + l.tax * 100, 0)) / 100);
  });
  it('shipping is added to the total but not to tax or subtotal', () => {
    const o = priceOrder([{ quantity: 1, unitPrice: 100, taxRatePct: 20, taxInclusive: true }], 35);
    expect(o).toMatchObject({ subtotal: 100, shippingTotal: 35, total: 135 });
  });
  it('an empty order is zero', () => expect(priceOrder([])).toMatchObject({ subtotal: 0, total: 0, taxTotal: 0 }));
});

describe('proportionalRefund', () => {
  it('refunds proportionally', () => expect(proportionalRefund(300, 3, 1, 0, 0)).toBe(100));
  it('the LAST units take the remainder so the cents always reconcile', () => {
    // 3 units sold for 100.00 (33.33 each): refunding one at a time must sum to exactly 100.00
    const a = proportionalRefund(100, 3, 1, 0, 0);
    const b = proportionalRefund(100, 3, 1, a, 1);
    const c = proportionalRefund(100, 3, 1, a + b, 2);
    expect([a, b, c]).toEqual([33.33, 33.33, 33.34]);
    expect(Math.round((a + b + c) * 100)).toBe(10000);
  });
  it('refuses to return more than was sold', () => expect(() => proportionalRefund(100, 2, 2, 0, 1)).toThrow(RangeError));
});
