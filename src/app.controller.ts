import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../generated/prisma/client.js';
import { AppService } from './app.service';
import { Roles } from './decorators/roles.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}


  @Get('home')
  @Roles(UserRole.CLIENT)
  getHome(@Req() req: Request & { user: { sub: number } }) {
    return this.appService.getHome(req.user.sub);
  }
}
