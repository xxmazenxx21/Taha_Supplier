import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingZoneDto } from './dto/create-shipping-zone.dto';
import { UpdateShippingZoneDto } from './dto/update-shipping-zone.dto';

@Injectable()
export class ShippingZoneService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── ADMIN ───────────────────────────────────────────────

  async create(dto: CreateShippingZoneDto) {
    const existing = await this.prisma.shippingZone.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Shipping zone name already exists');

    return  await this.prisma.shippingZone.create({
      data: {
        name: dto.name,
        shipping_cost: dto.shipping_cost,
        is_active: dto.is_active ?? true,
        display_order: dto.display_order ?? 0,
      },
    });
  }

  /** Get all shipping zones — no filter, for admin dashboard */
  async getAllShippingZonesForAdmin() {
    return await this.prisma.shippingZone.findMany({
      orderBy: { display_order: 'asc' },
    });
  }

  async update(id: number, dto: UpdateShippingZoneDto) {
    const zone = await this.prisma.shippingZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException('Shipping zone not found');

    if (dto.name && dto.name !== zone.name) {
      const nameConflict = await this.prisma.shippingZone.findUnique({
        where: { name: dto.name },
      });
      if (nameConflict) throw new ConflictException('Shipping zone name already exists');
    }

    return await this.prisma.shippingZone.update({
      where: { id },
      data: dto,
    });
  }

  // ─── CLIENT ──────────────────────────────────────────────

  /** Get only active shipping zones — for clients placing orders */
  async findAllActive() {
    return await this.prisma.shippingZone.findMany({
      where: { is_active: true },
      orderBy: { display_order: 'asc' },
      select: {
        id: true,
        name: true,
        shipping_cost: true,
        display_order: true,
      },
    });
  }
}
