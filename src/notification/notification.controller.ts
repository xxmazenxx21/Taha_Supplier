import { Body, Controller, Post } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { SendBroadcastNotificationDto } from './dto/send-broadcast-notification.dto';
import { NotificationService } from './notification.service';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('broadcast')
  @Roles(UserRole.ADMIN)
  sendBroadcast(@Body() dto: SendBroadcastNotificationDto) {
    return this.notificationService.sendBroadcastNotification(
      dto.title,
      dto.body,
    );
  }
}
