import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ShippingZoneService } from './shipping-zone.service';
import { CreateShippingZoneDto } from './dto/create-shipping-zone.dto';
import { UpdateShippingZoneDto } from './dto/update-shipping-zone.dto';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from '../guards/roles.guard';

@Controller('shipping-zone')
@UseGuards(RolesGuard)
export class ShippingZoneController {
  constructor(private readonly shippingZoneService: ShippingZoneService) {}

  // ─── ADMIN ROUTES ────────────────────────────────────────

  /** Create a new shipping zone (admin only) */
  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateShippingZoneDto) {
    return this.shippingZoneService.create(dto);
  }

  /** Get all shipping zones — no filters (admin only) */
  @Get('admin')
  @Roles('ADMIN')
  getAllShippingZonesForAdmin() {
    return this.shippingZoneService.getAllShippingZonesForAdmin();
  }

  /** Update a shipping zone (admin only) */
  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateShippingZoneDto) {
    return this.shippingZoneService.update(+id, dto);
  }

  // ─── CLIENT ROUTES ───────────────────────────────────────

  /** Get all active shipping zones (CLIENT role — for placing orders) */
  @Get()
  @Roles('CLIENT')
  findAllActive() {
    return this.shippingZoneService.findAllActive();
  }
}
