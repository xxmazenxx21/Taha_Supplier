import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
