import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'node:fs';
import {
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { getErrorMessage } from '../utils/error-message';
import { resolvePrivateUploadPath } from '../utils/multer/upload-paths';
import { PaymentStatusDecision } from './dto/update-payment-status.dto';
import { FindAdminOrdersDto } from './dto/find-admin-orders.dto';
import { formatOrderResponse } from './order.mapper';

const orderUserSelect = {
  id: true,
  name: true,
  shop_name: true,
  phone: true,
  email: true,
  address: true,
} satisfies Prisma.UserSelect;

/** Admin side of the order module: listing, review and status changes. */
@Injectable()
export class OrderAdminService {
  private readonly logger = new Logger(OrderAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async findAllOrders(query: FindAdminOrdersDto = {}) {
    const {
      page = 1,
      per_page = 20,
      status,
      payment_status,
      payment_method,
      user_id,
      from,
      to,
      exclude_cancelled,
    } = query;

    const where: Prisma.OrderWhereInput = {};

    if (status) where.status = status;
    if (exclude_cancelled && !status) {
      where.status = {
        notIn: [OrderStatus.CANCELLED, OrderStatus.CLIENTCANCELLED],
      };
    }
    if (payment_status) where.payment_status = payment_status;
    if (payment_method) where.payment_method = payment_method;
    if (user_id) where.user_id = user_id;
    if (from || to) {
      where.created_at = {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      };
    }

    const skip = (page - 1) * per_page;

    // count() and findMany() share the same `where` reference.
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: per_page,
        include: {
          items: true,
          shippingZone: true,
          user: { select: orderUserSelect },
        },
      }),
    ]);

    const last_page = Math.ceil(total / per_page) || 1;
    const next_page = page < last_page ? page + 1 : null;

    return {
      items: orders.map((order) => formatOrderResponse(order)),
      page,
      per_page,
      next_page,
      last_page,
      total,
    };
  }

  /** Admin detail view: everything needed to review a single order. */
  async findOneAdmin(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        shippingZone: true,
        user: { select: { ...orderUserSelect, status: true } },
        coupon: { select: { id: true, code: true, discount_value: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return {
      ...formatOrderResponse(order),
      // discount_value is a Decimal; surface it as a number like other money.
      coupon: order.coupon
        ? {
            id: order.coupon.id,
            code: order.coupon.code,
            discount_value: Number(order.coupon.discount_value),
          }
        : null,
    };
  }

  async findCancelledOrders() {
    const orders = await this.prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatus.CANCELLED, OrderStatus.CLIENTCANCELLED],
        },
      },
      orderBy: { created_at: 'desc' },
      include: {
        items: true,
        shippingZone: true,
        user: { select: orderUserSelect },
      },
    });

    return orders.map((order) => formatOrderResponse(order));
  }

  async updateStatus(orderId: number, status: OrderStatus) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, user_id: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status },
      include: {
        items: true,
        shippingZone: true,
        user: { select: orderUserSelect },
      },
    });

    // Committed — a push failure must not fail the request.
    try {
      const devices = await this.prisma.userDevice.findMany({
        where: { user_id: order.user_id },
        select: { token: true },
      });

      await this.notificationService.sendOrderStatusChangedNotification(
        devices.map((device) => device.token),
        updatedOrder.id,
        updatedOrder.status,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send order-status notification for order ${updatedOrder.id}: ${getErrorMessage(error)}`,
      );
    }

    return formatOrderResponse(updatedOrder);
  }

  async updatePaymentStatus(
    orderId: number,
    paymentStatus: PaymentStatusDecision,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        user_id: true,
        payment_method: true,
        payment_proof_image: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (
      order.payment_method !== PaymentMethod.CARD ||
      !order.payment_proof_image
    ) {
      throw new ConflictException(
        'Only card orders with an uploaded payment proof can be reviewed',
      );
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { payment_status: paymentStatus },
      include: {
        items: true,
        shippingZone: true,
        user: { select: orderUserSelect },
      },
    });

    // Committed — a push failure must not fail the request.
    try {
      const devices = await this.prisma.userDevice.findMany({
        where: { user_id: order.user_id },
        select: { token: true },
      });

      await this.notificationService.sendPaymentStatusUpdatedNotification(
        devices.map((device) => device.token),
        updatedOrder.id,
        updatedOrder.payment_status,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send payment-status notification for order ${updatedOrder.id}: ${getErrorMessage(error)}`,
      );
    }

    return formatOrderResponse(updatedOrder);
  }

  /**
   * Resolves the receipt to an absolute path for streaming.
   * `isAdmin` skips the ownership check; otherwise the order must belong to userId.
   */
  async getPaymentProofPath(
    userId: number,
    orderId: number,
    isAdmin: boolean,
  ): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, user_id: true, payment_proof_image: true },
    });

    if (!order || (!isAdmin && order.user_id !== userId)) {
      throw new NotFoundException('Order not found');
    }

    if (!order.payment_proof_image) {
      throw new NotFoundException('Payment proof not found');
    }

    const absolutePath = resolvePrivateUploadPath(order.payment_proof_image);
    if (!absolutePath) {
      throw new NotFoundException('Payment proof not found');
    }

    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Payment proof not found');
    }

    return absolutePath;
  }
}
