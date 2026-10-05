import { computePayslip, DEFAULT_PAYROLL, monthlyIncomeTax, periodBounds, workingDaysBetween } from './payroll';

describe('payroll maths', () => {
  it('income tax follows the progressive scale', () => {
    expect(monthlyIncomeTax(3000, DEFAULT_PAYROLL.brackets)).toBe(0); // 36,000 a year: below the first threshold
    expect(monthlyIncomeTax(5000, DEFAULT_PAYROLL.brackets)).toBe(166.67); // 60,000 a year at 10% - 4,000 = 2,000/12
    expect(monthlyIncomeTax(10000, DEFAULT_PAYROLL.brackets)).toBe(1566.67); // 120,000 a year at 34% - 22,000 = 18,800 → /12
    expect(monthlyIncomeTax(0, DEFAULT_PAYROLL.brackets)).toBe(0);
  });

  it('a 4,000 MAD salary: CNSS, AMO, abatement and tax are applied in order', () => {
    const r = computePayslip({ baseSalary: 4000, absentDays: 0, workingDays: 26, commissions: 0, bonuses: 0, overtime: 0, deductions: 0 });
    expect(r.gross).toBe(4000);
    expect(r.cnss).toBe(179.2); // 4.48%
    expect(r.amo).toBe(90.4); // 2.26%
    expect(r.proExpenses).toBe(1400); // 35% of gross
    expect(r.taxable).toBe(2330.4);
    expect(r.incomeTax).toBe(0); // 27,964.8 a year: under 40,000
    expect(r.net).toBe(3730.4);
  });

  it('CNSS is capped at the ceiling but AMO is not', () => {
    const r = computePayslip({ baseSalary: 12000, absentDays: 0, workingDays: 26, commissions: 0, bonuses: 0, overtime: 0, deductions: 0 });
    expect(r.cnss).toBe(268.8); // 6,000 × 4.48%
    expect(r.amo).toBe(271.2); // 12,000 × 2.26%
    expect(r.proExpenses).toBe(2916.67); // 25% of 12,000 = 3,000, capped at 2,916.67
    expect(r.net).toBeGreaterThan(9000);
    expect(r.net).toBeLessThan(12000);
  });

  it('unpaid days cut the base pro rata; commissions and bonuses add to gross; deductions only hit the net', () => {
    const r = computePayslip({ baseSalary: 5200, absentDays: 2, workingDays: 26, commissions: 800, bonuses: 200, overtime: 0, deductions: 150 });
    expect(r.absenceCut).toBe(400);
    expect(r.basePaid).toBe(4800);
    expect(r.gross).toBe(5800);
    expect(r.net).toBe(Math.round((r.gross - r.socialContrib - r.incomeTax - 150) * 100) / 100);
    const none = computePayslip({ baseSalary: 5200, absentDays: 0, workingDays: 26, commissions: 0, bonuses: 0, overtime: 0, deductions: 0 });
    expect(none.absenceCut).toBe(0);
  });

  it('cannot cut more than the base, handles zero working days', () => {
    expect(computePayslip({ baseSalary: 1000, absentDays: 99, workingDays: 26, commissions: 0, bonuses: 0, overtime: 0, deductions: 0 }).basePaid).toBe(0);
    expect(computePayslip({ baseSalary: 1000, absentDays: 3, workingDays: 0, commissions: 0, bonuses: 0, overtime: 0, deductions: 0 }).basePaid).toBe(1000);
  });

  it('counts working days (Mon-Sat by default) and builds period bounds', () => {
    expect(workingDaysBetween('2026-10-05', '2026-10-11')).toBe(6); // Mon..Sun → 6
    expect(workingDaysBetween('2026-10-05', '2026-10-11', [1, 2, 3, 4, 5])).toBe(5);
    expect(workingDaysBetween('2026-10-01', '2026-10-31')).toBe(27); // 31 days minus 4 Sundays
    expect(periodBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodBounds('2028-02').end).toBe('2028-02-29');
  });
});
