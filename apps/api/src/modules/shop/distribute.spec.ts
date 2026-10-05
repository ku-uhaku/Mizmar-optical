import { distribute } from './shop-checkout.service';

describe('distribute (coupon discount over lines)', () => {
  const sum = (a: number[]) => a.reduce((n, x) => n + x, 0);
  it('always adds up to the discount, to the cent', () => {
    for (const grosses of [[33333, 10001], [100, 100, 100], [1, 1, 1], [999, 1], [12345, 6789, 4321]]) {
      for (const d of [1, 2, 3, 50, 5000, 9999]) {
        const out = distribute(d, grosses);
        expect(sum(out)).toBe(Math.min(d, sum(grosses)));
        out.forEach((x, i) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(grosses[i]); });
      }
    }
  });
  it('is proportional and handles zero lines', () => {
    expect(distribute(1000, [30000, 10000])).toEqual([750, 250]);
    expect(distribute(500, [0, 0])).toEqual([0, 0]);
    expect(distribute(0, [100])).toEqual([0]);
    expect(distribute(500, [0, 1000])).toEqual([0, 500]);
  });
});
