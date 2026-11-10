import { Module } from '@nestjs/common';
import { CouponModule } from '../coupon/coupon.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';

@Module({
  imports: [PrismaModule, CouponModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
