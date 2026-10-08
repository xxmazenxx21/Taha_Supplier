import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import {
  privateMulterOptions,
  validateImageFiles,
} from '../utils/multer/multer';
import {
  getPrivateUploadRelativePath,
  PrivateUploadFolder,
} from '../utils/multer/upload-paths';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { FindAdminOrdersDto } from './dto/find-admin-orders.dto';

type AuthedRequest = Request & { user: { sub: number; role: string } };

@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @Roles(UserRole.CLIENT)
  @UseInterceptors(
    FileInterceptor(
      'payment_proof',
      privateMulterOptions(PrivateUploadFolder.PAYMENT_PROOFS),
    ),
  )
  create(
    @Req() req: AuthedRequest,
    @Body() createOrderDto: CreateOrderDto,
    @UploadedFile() paymentProof?: Express.Multer.File,
  ) {
    return this.orderService.create(
      req.user.sub,
      createOrderDto,
      this.toPaymentProofPath(paymentProof),
    );
  }

  @Get()
  @Roles(UserRole.CLIENT)
  findMyOrders(@Req() req: AuthedRequest) {
    return this.orderService.findMyOrders(req.user.sub);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.CLIENT)
  cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orderService.cancel(req.user.sub, this.parseId(id));
  }

  @Patch(':id/payment-proof')
  @Roles(UserRole.CLIENT)
  @UseInterceptors(
    FileInterceptor(
      'payment_proof',
      privateMulterOptions(PrivateUploadFolder.PAYMENT_PROOFS),
    ),
  )
  replacePaymentProof(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @UploadedFile() paymentProof?: Express.Multer.File,
  ) {
    const paymentProofPath = this.toPaymentProofPath(paymentProof);
    if (!paymentProofPath) {
      throw new BadRequestException('payment_proof is required');
    }

    return this.orderService.replacePaymentProof(
      req.user.sub,
      this.parseId(id),
      paymentProofPath,
    );
  }

  @Patch(':id/payment-status')
  @Roles(UserRole.ADMIN)
  updatePaymentStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    return this.orderService.updatePaymentStatus(
      this.parseId(id),
      dto.payment_status,
    );
  }

  // Streams the file directly, so this route is intentionally outside the
  // global response envelope.
  @Get(':id/payment-proof')
  @Roles(UserRole.ADMIN, UserRole.CLIENT)
  async getPaymentProof(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const absolutePath = await this.orderService.getPaymentProofPath(
      req.user.sub,
      this.parseId(id),
      req.user.role === UserRole.ADMIN,
    );

    res.sendFile(absolutePath);
  }

  // Literal 'admin/cancelled' MUST stay declared before 'admin/:id',
  // otherwise 'cancelled' binds as the :id param.
  @Get('admin/cancelled')
  @Roles(UserRole.ADMIN)
  findCancelledOrders() {
    return this.orderService.findCancelledOrders();
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  findAllOrders(@Query() query: FindAdminOrdersDto) {
    return this.orderService.findAllOrders(query);
  }

  // Must stay declared after 'admin/cancelled' and before @Get(':id')
  @Get('admin/:id')
  @Roles(UserRole.ADMIN)
  findOneAdmin(@Param('id') id: string) {
    return this.orderService.findOneAdmin(this.parseId(id));
  }

  @Get(':id')
  @Roles(UserRole.CLIENT)
  findMyOrder(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orderService.findMyOrder(req.user.sub, this.parseId(id));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orderService.updateStatus(this.parseId(id), dto.status);
  }

  private toPaymentProofPath(file?: Express.Multer.File): string | undefined {
    if (!file) {
      return undefined;
    }

    validateImageFiles([file]);

    return getPrivateUploadRelativePath(
      PrivateUploadFolder.PAYMENT_PROOFS,
      file.filename,
    );
  }

  private parseId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('Invalid order id');
    }
    return id;
  }
}
