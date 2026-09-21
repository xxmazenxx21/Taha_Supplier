import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @Roles(UserRole.CLIENT)
  create(
    @Req() req: Request & { user: { sub: number; role: string } },
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.orderService.create(req.user.sub, createOrderDto);
  }

  @Get()
  @Roles(UserRole.CLIENT)
  findMyOrders(@Req() req: Request & { user: { sub: number; role: string } }) {
    return this.orderService.findMyOrders(req.user.sub);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.CLIENT)
  cancel(
    @Req() req: Request & { user: { sub: number; role: string } },
    @Param('id') id: string,
  ) {
    return this.orderService.cancel(req.user.sub, this.parseId(id));
  }

  @Get('admin/cancelled')
  @Roles(UserRole.ADMIN)
  findCancelledOrders() {
    return this.orderService.findCancelledOrders();
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  findAllOrders() {
    return this.orderService.findAllOrders();
  }

  @Get(':id')
  @Roles(UserRole.CLIENT)
  findMyOrder(
    @Req() req: Request & { user: { sub: number; role: string } },
    @Param('id') id: string,
  ) {
    return this.orderService.findMyOrder(req.user.sub, this.parseId(id));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orderService.updateStatus(this.parseId(id), dto.status);
  }

  private parseId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('Invalid order id');
    }
    return id;
  }
}
