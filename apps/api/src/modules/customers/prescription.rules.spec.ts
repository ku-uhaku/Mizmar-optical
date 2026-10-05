import { BadRequestException } from '@nestjs/common';
import { isExpired, sphericalEquivalent, validatePrescription } from './prescription.rules';

const base = { issuedAt: new Date('2026-06-15'), odSph: -1.5, osSph: -1.25 };
const errorsOf = (rx: object, today = new Date('2026-10-05')) => {
  try { validatePrescription({ ...base, ...rx }, today); return []; }
  catch (e) { return ((e as BadRequestException).getResponse() as any).details as string[]; }
};

describe('validatePrescription', () => {
  it('accepts a normal single-vision prescription', () => expect(errorsOf({})).toEqual([]));
  it('accepts cylinder with axis, and a progressive with addition', () => {
    expect(errorsOf({ odCyl: -0.75, odAxis: 90, osCyl: -0.5, osAxis: 180, odAdd: 2, osAdd: 2.25 })).toEqual([]);
  });
  it('requires an axis when a cylinder is given (per eye)', () => {
    expect(errorsOf({ odCyl: -0.75 })).toEqual(['OD axis is required when a cylinder is given']);
    expect(errorsOf({ osCyl: -1, odCyl: -1, odAxis: 10 })).toEqual(['OS axis is required when a cylinder is given']);
  });
  it('rejects an axis without a (non-zero) cylinder', () => {
    expect(errorsOf({ odAxis: 90 })).toEqual(['OD axis requires a non-zero cylinder']);
    expect(errorsOf({ odCyl: 0, odAxis: 90 })).toEqual(['OD axis requires a non-zero cylinder']);
  });
  it('enforces 0.25-dioptre steps on sphere, cylinder and addition', () => {
    expect(errorsOf({ odSph: -1.3 })).toContain('OD sphere must be in 0.25 steps');
    expect(errorsOf({ osCyl: -0.6, osAxis: 5 })).toContain('OS cylinder must be in 0.25 steps');
    expect(errorsOf({ odAdd: 1.1 })).toContain('OD addition must be in 0.25 steps');
    expect(errorsOf({ odSph: -0.25, osSph: 6.75 })).toEqual([]);
  });
  it('requires a base direction for prism', () => {
    expect(errorsOf({ odPrism: 2 })).toEqual(['OD prism requires a base direction']);
    expect(errorsOf({ odPrism: 2, odBase: 'IN' })).toEqual([]);
  });
  it('needs at least one measurement', () => {
    expect(errorsOf({ odSph: undefined, osSph: undefined })).toEqual(['At least one eye needs a measurement (sphere, cylinder, addition or prism)']);
  });
  it('accepts plano (0.00) as a measurement', () => expect(errorsOf({ odSph: 0, osSph: 0 })).toEqual([]));
  it('validates dates: no future issue date, expiry not before issue', () => {
    expect(errorsOf({ issuedAt: new Date('2026-12-01') })).toEqual(['Issue date cannot be in the future']);
    expect(errorsOf({ expiresAt: new Date('2026-01-01') })).toEqual(['Expiry date cannot be before the issue date']);
    expect(errorsOf({ issuedAt: new Date('2026-10-05T10:00:00Z') })).toEqual([]); // today is fine
  });
  it('reports every problem at once, as a 400 with a stable code', () => {
    try { validatePrescription({ issuedAt: new Date('2026-06-15'), odSph: -1.3, odCyl: -0.5, osPrism: 1 }, new Date('2026-10-05')); fail('should throw'); }
    catch (e) {
      const r = (e as BadRequestException).getResponse() as any;
      expect((e as BadRequestException).getStatus()).toBe(400);
      expect(r.code).toBe('INVALID_PRESCRIPTION');
      expect(r.details).toEqual(expect.arrayContaining(['OD sphere must be in 0.25 steps', 'OD axis is required when a cylinder is given', 'OS prism requires a base direction']));
    }
  });
});

describe('helpers', () => {
  it('spherical equivalent = sph + cyl/2, rounded to 0.01', () => {
    expect(sphericalEquivalent(-2, -1)).toBe(-2.5);
    expect(sphericalEquivalent(1.25, -0.75)).toBe(0.88);
    expect(sphericalEquivalent(-2, -0.75)).toBe(-2.38); // half rounds away from zero…
    expect(sphericalEquivalent(2, 0.75)).toBe(2.38); // …symmetrically for plus powers
    expect(sphericalEquivalent(-1, null)).toBe(-1);
    expect(sphericalEquivalent(null, -1)).toBeNull();
  });
  it('isExpired only after the expiry DAY has passed', () => {
    const today = new Date('2026-10-05T15:00:00');
    expect(isExpired(new Date('2026-10-05'), today)).toBe(false);
    expect(isExpired(new Date('2026-10-04'), today)).toBe(true);
    expect(isExpired(null, today)).toBe(false);
  });
});
