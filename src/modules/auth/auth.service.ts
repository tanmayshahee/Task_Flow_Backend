import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

type Tokens = { access_token: string; refresh_token: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  // ---------- helpers ----------
  private async getTokens(user: { id: string; email: string; role: string }): Promise<Tokens> {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const [access_token, refresh_token] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.cfg.get('JWT_ACCESS_SECRET'),
        expiresIn: this.cfg.get('JWT_ACCESS_EXPIRES'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.cfg.get('JWT_REFRESH_SECRET'),
        expiresIn: this.cfg.get('JWT_REFRESH_EXPIRES'),
      }),
    ]);

    return { access_token, refresh_token };
  }

  private async setRefreshToken(userId: string, rt: string): Promise<void> {
    const hash = await bcrypt.hash(rt, 12);
    await this.usersService.setRefreshTokenHash(userId, hash);
  }

  private async clearRefreshToken(userId: string): Promise<void> {
    await this.usersService.clearRefreshTokenHash(userId);
  }

  // ---------- flows ----------
  async login(dto: LoginDto) {
    const { email, password } = dto;
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid email');

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid password');

    const tokens = await this.getTokens(user);
    await this.setRefreshToken(user.id, tokens.refresh_token); // rotate on login

    return {
      ...tokens,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new UnauthorizedException('Email already exists');
    const user = await this.usersService.create(dto);

    const tokens = await this.getTokens(user);
    await this.setRefreshToken(user.id, tokens.refresh_token);

    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  async logout(userId: string) {
    await this.clearRefreshToken(userId);
    return { success: true };
  }

  // **Refresh rotation with reuse detection**
  async refreshTokens(userId: string, refreshToken: string): Promise<Tokens> {
    const user = await this.usersService.findOne(userId);
    if (!user || !user.refreshTokenHash) throw new UnauthorizedException('Access denied');

    const valid = await bcrypt.compare(refreshToken, user.refreshTokenHash);

    if (!valid) {
      // Token reuse detected: kill the session
      await this.clearRefreshToken(userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const tokens = await this.getTokens(user);
    await this.setRefreshToken(user.id, tokens.refresh_token); // ROTATE

    return tokens;
  }
}
