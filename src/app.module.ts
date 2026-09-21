import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthModule } from './auth/auth.module';
import { CategoryModule } from './category/category.module';
import { BrandModule } from './brand/brand.module';
import { ProductModule } from './product/product.module';
import { CartModule } from './cart/cart.module';
import { CouponModule } from './coupon/coupon.module';
import { SubCategoryModule } from './sub-category/sub-category.module';
import { ReviewModule } from './review/review.module';
import { ShippingZoneModule } from './shipping-zone/shipping-zone.module';
import { OrderModule } from './order/order.module';
import { BannerModule } from './banner/banner.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'defaultSecret',
        signOptions: { expiresIn: '3650d' },
      }),
      inject: [ConfigService],
      global: true,
    }),
    PrismaModule,
    AuthModule,
    CategoryModule,
    BrandModule,
    ProductModule,
    CartModule,
    CouponModule,
    SubCategoryModule,
    ReviewModule,
    ShippingZoneModule,
    OrderModule,
    BannerModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
