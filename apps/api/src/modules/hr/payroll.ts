/**
 * Basic monthly payroll maths (pure, no database). Defaults follow the Moroccan salaried-employee scheme in a SIMPLIFIED form:
 * CNSS (capped) + AMO contributions, a professional-expenses abatement, then the progressive income-tax scale (annualised, /12).
 * Every figure is configurable (setting `payroll_config`) because rates and scales change: have an accountant validate them
 * before paying real salaries. Amounts are handled in cents internally.
 */
export interface PayrollConfig {
  cnssRate: number; cnssCeiling: number; amoRate: number;
  proExpenses: { thresholdMonthly: number; lowRate: number; lowCapMonthly: number; highRate: number; highCapMonthly: number };
  /** Annual taxable income scale: income above `from` is taxed at `rate`, minus `deduct`. */
  brackets: { from: number; rate: number; deduct: number }[];
  workingWeekdays: number[]; // 0 = Sunday
}

export const DEFAULT_PAYROLL: PayrollConfig = {
  cnssRate: 4.48, cnssCeiling: 6000, amoRate: 2.26,
  proExpenses: { thresholdMonthly: 6500, lowRate: 35, lowCapMonthly: 2500, highRate: 25, highCapMonthly: 2916.67 },
  brackets: [{ from: 0, rate: 0, deduct: 0 }, { from: 40_000, rate: 10, deduct: 4000 }, { from: 60_000, rate: 20, deduct: 10_000 }, { from: 80_000, rate: 30, deduct: 18_000 }, { from: 100_000, rate: 34, deduct: 22_000 }, { from: 180_000, rate: 37, deduct: 28_400 }],
  workingWeekdays: [1, 2, 3, 4, 5, 6],
};

const c = (n: number) => Math.round(n * 100 + (n < 0 ? -1e-9 : 1e-9));
const m = (cents: number) => cents / 100;

export interface PayslipInput { baseSalary: number; absentDays: number; workingDays: number; commissions: number; bonuses: number; overtime: number; deductions: number }
export interface PayslipResult {
  baseSalary: number; basePaid: number; absenceCut: number; gross: number; cnss: number; amo: number; socialContrib: number; proExpenses: number; taxable: number; incomeTax: number; net: number;
}

/** Monthly income tax from a monthly taxable amount, by annualising it against the scale. */
export function monthlyIncomeTax(taxableMonthly: number, brackets: PayrollConfig['brackets']): number {
  const annual = taxableMonthly * 12;
  if (annual <= 0) return 0;
  const b = [...brackets].sort((x, y) => x.from - y.from).filter((x) => annual > x.from).pop();
  if (!b) return 0;
  return Math.max(0, m(c(((annual * b.rate) / 100 - b.deduct) / 12)));
}

export function computePayslip(i: PayslipInput, cfg: PayrollConfig = DEFAULT_PAYROLL): PayslipResult {
  const baseCents = c(i.baseSalary);
  // unpaid days are cut pro rata of the working days of the month
  const cutCents = i.workingDays > 0 ? Math.min(baseCents, Math.round((baseCents * Math.min(i.absentDays, i.workingDays)) / i.workingDays)) : 0;
  const paidBase = baseCents - cutCents;
  const grossCents = paidBase + c(i.commissions) + c(i.bonuses) + c(i.overtime);
  const cnss = Math.round((Math.min(grossCents, c(cfg.cnssCeiling)) * cfg.cnssRate) / 100);
  const amo = Math.round((grossCents * cfg.amoRate) / 100);
  const pe = cfg.proExpenses;
  const grossM = m(grossCents);
  const proCents = Math.min(Math.round((grossCents * (grossM <= pe.thresholdMonthly ? pe.lowRate : pe.highRate)) / 100), c(grossM <= pe.thresholdMonthly ? pe.lowCapMonthly : pe.highCapMonthly));
  const taxableCents = Math.max(0, grossCents - cnss - amo - proCents);
  const taxCents = c(monthlyIncomeTax(m(taxableCents), cfg.brackets));
  const netCents = grossCents - cnss - amo - taxCents - c(i.deductions);
  return { baseSalary: m(baseCents), basePaid: m(paidBase), absenceCut: m(cutCents), gross: m(grossCents), cnss: m(cnss), amo: m(amo), socialContrib: m(cnss + amo), proExpenses: m(proCents), taxable: m(taxableCents), incomeTax: m(taxCents), net: m(netCents) };
}

/** Days in [start, end] (YYYY-MM-DD, inclusive) that fall on a working weekday. */
export function workingDaysBetween(start: string, end: string, weekdays: number[] = DEFAULT_PAYROLL.workingWeekdays): number {
  let n = 0;
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) if (weekdays.includes(new Date(t).getUTCDay())) n++;
  return n;
}

export const periodBounds = (periodKey: string) => {
  const [y, mo] = periodKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(last)}` };
};
