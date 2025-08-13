// auth/strategies/jwt-refresh.strategy.ts (for refresh tokens)
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // or read from cookies
      secretOrKey: cfg.get<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }
  validate(req: Request, payload: any) {
    // Expose the raw refresh token for hash comparison
    const auth = req.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    return { ...payload, refreshToken: token };
  }
}
