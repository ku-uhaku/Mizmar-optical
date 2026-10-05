import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface ChargeRequest { orderId: string; number: string; amount: number; currency: string; config: Record<string, unknown> }
export interface ChargeResult { status: 'CAPTURED' | 'PENDING' | 'REDIRECT'; transactionId?: string; redirectUrl?: string; payload?: unknown }
export interface PaymentProvider { readonly code: string; charge(req: ChargeRequest): Promise<ChargeResult> }

/** Simulated card payment for development and demos: no card data, no money. Refused in production unless the method opts in (`config.allowDemo`). */
class DemoProvider implements PaymentProvider {
  readonly code = 'demo';
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (process.env.NODE_ENV === 'production' && req.config.allowDemo !== true) throw new Error('The demo payment provider is disabled in production');
    return { status: 'CAPTURED', transactionId: `demo_${randomUUID()}`, payload: { simulated: true } };
  }
}

/**
 * Pluggable online payment gateways. A real provider (CMI, Stripe, PayPal…) implements `PaymentProvider`, returns REDIRECT with the
 * hosted-page URL (or CAPTURED when the charge is synchronous) and is registered here; a payment method row (dashboard-editable)
 * selects it by `provider`. Secrets belong in environment variables, never in the method's `config`.
 */
@Injectable()
export class PaymentProviders {
  private readonly all = new Map<string, PaymentProvider>();
  constructor() { this.register(new DemoProvider()); }
  register(p: PaymentProvider) { this.all.set(p.code, p); }
  get(code: string | null | undefined) { return code ? this.all.get(code) : undefined; }
}
