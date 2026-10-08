import {
  Controller,
  Get,
  Req,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { CartService } from './cart.service';
import { CreateCartItemDto } from './dto/create-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { ApplyCouponDto } from './dto/apply-coupon.dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @Roles(UserRole.CLIENT)
  findOrCreateMyCart(
    @Req() req: Request & { user: { sub: number; role: string } },
  ) {
    return this.cartService.getCartWithTotals(req.user.sub);
  }

  @Post('items')
  @Roles(UserRole.CLIENT)
  addItem(
    @Req() req: Request & { user: { sub: number; role: string } },
    @Body() dto: CreateCartItemDto,
  ) {
    return this.cartService.addItemToCart(
      req.user.sub,
      dto.product_id,
      dto.quantity,
    );
  }

  @Patch('items/:id')
  @Roles(UserRole.CLIENT)
  updateItem(
    @Req() req: Request & { user: { sub: number; role: string } },
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const qty = dto.quantity ?? 0;
    return this.cartService.updateItem(req.user.sub, +id, qty);
  }

  @Delete('items/:id')
  @Roles(UserRole.CLIENT)
  removeItem(
    @Req() req: Request & { user: { sub: number; role: string } },
    @Param('id') id: string,
  ) {
    return this.cartService.removeItem(req.user.sub, +id);
  }

  @Post('apply-coupon')
  @Roles(UserRole.CLIENT)
  applyCoupon(
    @Req() req: Request & { user: { sub: number; role: string } },
    @Body() dto: ApplyCouponDto,
  ) {
    return this.cartService.applyCoupon(req.user.sub, dto.code);
  }

  @Post('remove-coupon')
  @Roles(UserRole.CLIENT)
  removeCoupon(@Req() req: Request & { user: { sub: number; role: string } }) {
    return this.cartService.removeCoupon(req.user.sub);
  }
}
