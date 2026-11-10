import { Module } from '@nestjs/common';
import { CouponModule } from '../coupon/coupon.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderService } from './order.service';
import { OrderAdminService } from './order-admin.service';
import { OrderController } from './order.controller';

@Module({
  imports: [PrismaModule, NotificationModule, CouponModule],
  controllers: [OrderController],
  providers: [OrderService, OrderAdminService],
})
export class OrderModule {}
