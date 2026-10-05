import { BadRequestException } from '@nestjs/common';

type N = number | null | undefined;
const EYES = ['od', 'os'] as const;
const quarter = (v: N) => v == null || Math.abs(v * 4 - Math.round(v * 4)) < 1e-9;

/**
 * Optical business rules that single-field decorators can't express. Run on the MERGED record (existing + changes), so
 * partial updates can't sneak in an inconsistent state (e.g. adding a cylinder without ever giving the axis).
 * Throws one 400 listing every problem so the form can show them all at once.
 */
export function validatePrescription(rx: Record<string, any>, today = new Date()) {
  const errors: string[] = [];
  for (const eye of EYES) {
    const sph: N = rx[`${eye}Sph`], cyl: N = rx[`${eye}Cyl`], axis: N = rx[`${eye}Axis`], add: N = rx[`${eye}Add`];
    const label = eye.toUpperCase();
    if (!quarter(sph)) errors.push(`${label} sphere must be in 0.25 steps`);
    if (!quarter(cyl)) errors.push(`${label} cylinder must be in 0.25 steps`);
    if (!quarter(add)) errors.push(`${label} addition must be in 0.25 steps`);
    if (cyl != null && cyl !== 0 && axis == null) errors.push(`${label} axis is required when a cylinder is given`);
    if (axis != null && (cyl == null || cyl === 0)) errors.push(`${label} axis requires a non-zero cylinder`);
    if (rx[`${eye}Prism`] != null && rx[`${eye}Prism`] !== 0 && !rx[`${eye}Base`]) errors.push(`${label} prism requires a base direction`);
  }
  const hasValue = EYES.some((e) => ['Sph', 'Cyl', 'Add', 'Prism'].some((f) => rx[`${e}${f}`] != null));
  if (!hasValue) errors.push('At least one eye needs a measurement (sphere, cylinder, addition or prism)');
  const issued = rx.issuedAt ? new Date(rx.issuedAt) : null, expires = rx.expiresAt ? new Date(rx.expiresAt) : null;
  if (issued && issued.getTime() > today.getTime() + 86_400_000) errors.push('Issue date cannot be in the future');
  if (issued && expires && expires < issued) errors.push('Expiry date cannot be before the issue date');
  if (errors.length) throw new BadRequestException({ code: 'INVALID_PRESCRIPTION', message: 'Prescription is not valid', details: errors });
}

/** Spherical equivalent (sph + cyl/2): handy for lens selection and for sanity checks in the UI. */
/** Rounds half AWAY from zero so -2.375 and +2.375 give the same magnitude (Math.round would favour +infinity). */
const roundHalfAway = (x: number, places = 2) => { const f = 10 ** places; return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f; };
export const sphericalEquivalent = (sph: N, cyl: N) => (sph == null ? null : roundHalfAway(sph + (cyl ?? 0) / 2));
export const isExpired = (expiresAt: Date | null | undefined, today = new Date()) => !!expiresAt && expiresAt < new Date(today.toDateString());
