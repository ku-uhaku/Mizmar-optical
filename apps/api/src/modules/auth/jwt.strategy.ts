import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../config/env';
import type { AuthUser } from '../../common/types';
import { AuthService } from './auth.service';

export interface JwtPayload { sub: string; email: string }

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>, private readonly auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  /** Loads fresh roles/permissions on every request so revocations apply immediately. */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.auth.loadAuthUser(payload.sub);
    if (!user) throw new UnauthorizedException('Account is disabled or no longer exists');
    return user;
  }
}
