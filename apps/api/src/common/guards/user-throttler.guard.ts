import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit key: the authenticated USER when there is one, otherwise the client IP.
 * A shop's staff usually share one public IP (router NAT); keying by IP would let one busy colleague lock out the rest.
 * Must run AFTER JwtAuthGuard so `req.user` is populated. Credential endpoints are public, so they stay per-IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
  }
}
