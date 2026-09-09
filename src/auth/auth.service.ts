import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { comparePassword, hashPassword } from '../utils/security/hashing';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

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
    let user;

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

    const access_token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      access_token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    };
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

    const access_token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      access_token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    };
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

    const access_token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      access_token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    };
  }
}
