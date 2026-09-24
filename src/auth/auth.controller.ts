import { Body, Controller, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Public()
  signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Post('login')
  @Public()
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @Public()
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('logout')
  @Public()
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refresh_token);
  }

  @Patch('fcm-token')
  @Roles(UserRole.CLIENT)
  updateFcmToken(
    @Req() req: Request & { user: { sub: number } },
    @Body() dto: UpdateFcmTokenDto,
  ) {
    return this.authService.updateFcmToken(
      req.user.sub,
      dto.fcm_token,
      dto.platform,
    );
  }

  @Post('adminDashboard/signup')
  @Public()
  adminDashboardSignup(
    @Body()
    adminData: {
      name: string;
      email: string;
      password: string;
      phone: string;
    },
  ) {
    return this.authService.adminDashboardSignup(adminData);
  }

  @Post('adminDashboard/login')
  @Public()
  adminDashboardLogin(@Body() loginDto: LoginDto) {
    return this.authService.adminDashboardLogin(loginDto);
  }
}
