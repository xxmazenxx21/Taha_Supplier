import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, UserRole, UserStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { comparePassword, hashPassword } from '../utils/security/hashing';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type AuthUser = {
  id: number;
  name: string;
  email: string | null;
  phone: string;
  role: UserRole;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto) {
    const [existingEmail, existingPhone] = await Promise.all([
      signupDto.email
        ? this.prisma.user.findUnique({ where: { email: signupDto.email } })
        : null,
      this.prisma.user.findUnique({ where: { phone: signupDto.phone } }),
    ]);

    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    if (existingPhone) {
      throw new ConflictException('Phone number already exists');
    }

    const hashedPassword = await hashPassword(signupDto.password);
    let user: Prisma.UserGetPayload<{
      select: {
        id: true;
        name: true;
        email: true;
        phone: true;
        role: true;
      };
    }>;

    try {
      user = await this.prisma.user.create({
        data: {
          name: signupDto.name,
          shop_name: signupDto.shop_name,
          email: signupDto.email,
          phone: signupDto.phone,
          address: signupDto.address,
          latitude: signupDto.latitude,
          longitude: signupDto.longitude,
          password: hashedPassword,
          role: UserRole.CLIENT,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const field = (error.meta?.target as string[])?.[0];
        throw new ConflictException(`${field} already exists`);
      }
      throw error;
    }

    if (signupDto.fcm_token) {
      await this.registerFcmToken(
        user.id,
        signupDto.fcm_token,
        signupDto.platform,
      );
    }

    return this.createAuthResponse(user);
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await comparePassword(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException('Account is banned');
    }

    if (loginDto.fcm_token) {
      await this.registerFcmToken(
        user.id,
        loginDto.fcm_token,
        loginDto.platform,
      );
    }

    return this.createAuthResponse(user);
  }

  async adminDashboardSignup(adminData: {
    name: string;
    email: string;
    password: string;
    phone: string;
  }) {
    const hashedPassword = await hashPassword(adminData.password);
    const user = await this.prisma.user.create({
      data: {
        name: adminData.name,
        email: adminData.email,
        phone: adminData.phone,
        password: hashedPassword,
        role: UserRole.ADMIN,
      },
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    };
  }

  async updateFcmToken(userId: number, fcmToken: string, platform?: string) {
    await this.registerFcmToken(userId, fcmToken, platform);

    return { success: true };
  }

  private registerFcmToken(
    userId: number,
    fcmToken: string,
    platform?: string,
  ) {
    return this.prisma.userDevice.upsert({
      where: { token: fcmToken },
      update: {
        user_id: userId,
        ...(platform !== undefined && { platform }),
      },
      create: {
        user_id: userId,
        token: fcmToken,
        platform,
      },
    });
  }

  async adminDashboardLogin(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });
    const DUMMY_HASH =
      '$2b$10$CwTycUXWue0Thq9StjUM0uJ8k9jI0GzX2gY2p6qU2n8g3rL7g9O1e';
    const isValidAdmin = !!user && user.role === UserRole.ADMIN;

    // بتعمل المقارنة دايمًا، حتى لو الـ user مش موجود أو مش أدمن، عشان الزمن يفضل ثابت
    const isPasswordValid = await comparePassword(
      loginDto.password,
      isValidAdmin ? user.password : DUMMY_HASH,
    );

    if (!isValidAdmin || !isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException('Account is banned');
    }

    return this.createAuthResponse(user);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const newRefreshToken = this.generateRefreshToken();
    const newTokenHash = this.hashRefreshToken(newRefreshToken);
    const now = new Date();

    const user = await this.prisma.$transaction(async (tx) => {
      const storedToken = await tx.refreshToken.findUnique({
        where: { token_hash: tokenHash },
        include: { user: true },
      });

      if (
        !storedToken ||
        storedToken.revoked_at !== null ||
        storedToken.expires_at <= now
      ) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      // Access tokens live 15 minutes, so refusing to refresh is what actually
      // locks a banned user out.
      if (storedToken.user.status === UserStatus.BANNED) {
        throw new ForbiddenException('Account is banned');
      }

      const revoked = await tx.refreshToken.updateMany({
        where: { id: storedToken.id, revoked_at: null },
        data: { revoked_at: now },
      });

      if (revoked.count !== 1) {
        throw new UnauthorizedException('Refresh token has already been used');
      }

      await tx.refreshToken.create({
        data: {
          user_id: storedToken.user_id,
          token_hash: newTokenHash,
          expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });

      return storedToken.user;
    });

    return this.createAuthResponse(user, newRefreshToken);
  }

  /**
   * Revokes every live refresh token for a user (e.g. after a password change
   * or a ban). Pass `tx` to enlist in a caller's transaction so the revocation
   * commits atomically with whatever triggered it.
   */
  async revokeAllRefreshTokens(userId: number, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;

    await client.refreshToken.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        token_hash: this.hashRefreshToken(refreshToken),
        revoked_at: null,
      },
      data: { revoked_at: new Date() },
    });

    return { success: true };
  }

  /**
   * Issues an access token plus a refresh token. Public so flows outside this
   * service (e.g. a password change) can re-issue credentials without
   * duplicating the token logic.
   */
  async createAuthResponse(user: AuthUser, existingRefreshToken?: string) {
    const access_token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    const refresh_token =
      existingRefreshToken ?? (await this.createRefreshToken(user.id));

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    };
  }

  private async createRefreshToken(userId: number): Promise<string> {
    const refreshToken = this.generateRefreshToken();

    await this.prisma.refreshToken.create({
      data: {
        user_id: userId,
        token_hash: this.hashRefreshToken(refreshToken),
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return refreshToken;
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }
}
