import { Module } from '@nestjs/common';
import { ShippingZoneService } from './shipping-zone.service';
import { ShippingZoneController } from './shipping-zone.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShippingZoneController],
  providers: [ShippingZoneService],
})
export class ShippingZoneModule {}
