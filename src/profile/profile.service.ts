import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { comparePassword, hashPassword } from '../utils/security/hashing';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const PROFILE_SELECT = {
  id: true,
  name: true,
  shop_name: true,
  phone: true,
  email: true,
  address: true,
  latitude: true,
  longitude: true,
  created_at: true,
} as const;

type ProfileRow = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.formatProfile(user);
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Mapped field by field — role, status and password are not reachable here.
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shop_name !== undefined) data.shop_name = dto.shop_name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: PROFILE_SELECT,
      });

      return this.formatProfile(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const field = (error.meta?.target as string[])?.[0] ?? 'field';
        throw new ConflictException(`${field} already exists`);
      }
      throw error;
    }
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        password: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isCurrentPasswordValid = await comparePassword(
      dto.current_password,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await hashPassword(dto.new_password);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Every existing session is invalidated, then a fresh pair is issued.
    await this.authService.revokeAllRefreshTokens(userId);

    return this.authService.createAuthResponse({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    });
  }

  private formatProfile(user: ProfileRow) {
    return {
      id: user.id,
      name: user.name,
      shop_name: user.shop_name,
      phone: user.phone,
      email: user.email,
      address: user.address,
      latitude: user.latitude !== null ? Number(user.latitude) : null,
      longitude: user.longitude !== null ? Number(user.longitude) : null,
      created_at: user.created_at,
    };
  }
}
