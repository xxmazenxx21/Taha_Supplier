import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

type AuthedRequest = Request & { user: { sub: number } };

@Controller('profile')
@Roles(UserRole.CLIENT)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @Roles(UserRole.CLIENT)
  getProfile(@Req() req: AuthedRequest) {
    return this.profileService.getProfile(req.user.sub);
  }

  @Patch()
  @Roles(UserRole.CLIENT)
  updateProfile(@Req() req: AuthedRequest, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.sub, dto);
  }

  @Patch('password')
  @Roles(UserRole.CLIENT)
  changePassword(@Req() req: AuthedRequest, @Body() dto: ChangePasswordDto) {
    return this.profileService.changePassword(req.user.sub, dto);
  }
}
