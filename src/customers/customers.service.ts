import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { FindCustomersDto } from './dto/find-customers.dto';
import { UpdateCustomerStatusDto } from './dto/update-customer-status.dto';

/** What the admin counts as a "return" when judging a customer. */
const CANCELLED_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.CLIENTCANCELLED,
];

/** Never includes password or refresh tokens. */
const CUSTOMER_LIST_SELECT = {
  id: true,
  name: true,
  shop_name: true,
  phone: true,
  email: true,
  address: true,
  status: true,
  block_reason: true,
  created_at: true,
} as const;

const CUSTOMER_DETAIL_SELECT = {
  ...CUSTOMER_LIST_SELECT,
  latitude: true,
  longitude: true,
} as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async findAllForAdmin(query: FindCustomersDto = {}) {
    const { page = 1, per_page = 20, search, status } = query;

    // role is pinned to CLIENT: staff accounts are never listed here.
    const where: Prisma.UserWhereInput = { role: UserRole.CLIENT };

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { shop_name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * per_page;

    // count() and findMany() share the same `where` reference.
    const [total, customers] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: per_page,
        select: {
          ...CUSTOMER_LIST_SELECT,
          _count: { select: { orders: true } },
        },
      }),
    ]);

    // One grouped query for the whole page instead of a count per row.
    const cancelledByUser = await this.countCancelledOrders(
      customers.map((customer) => customer.id),
    );

    const last_page = Math.ceil(total / per_page) || 1;
    const next_page = page < last_page ? page + 1 : null;

    return {
      items: customers.map(({ _count, ...customer }) => ({
        ...customer,
        orders_count: _count.orders,
        cancelled_orders_count: cancelledByUser.get(customer.id) ?? 0,
      })),
      page,
      per_page,
      next_page,
      last_page,
      total,
    };
  }

  async findOneForAdmin(id: number) {
    const customer = await this.prisma.user.findFirst({
      where: { id, role: UserRole.CLIENT },
      select: {
        ...CUSTOMER_DETAIL_SELECT,
        _count: { select: { orders: true } },
        orders: {
          orderBy: { created_at: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            payment_status: true,
            total_amount: true,
            created_at: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const cancelled_orders_count = await this.prisma.order.count({
      where: { user_id: id, status: { in: CANCELLED_STATUSES } },
    });

    const { _count, orders, latitude, longitude, ...rest } = customer;

    return {
      ...rest,
      latitude: latitude !== null ? Number(latitude) : null,
      longitude: longitude !== null ? Number(longitude) : null,
      orders_count: _count.orders,
      cancelled_orders_count,
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        payment_status: order.payment_status,
        total_amount: Number(order.total_amount),
        created_at: order.created_at,
      })),
    };
  }

  async updateStatus(id: number, dto: UpdateCustomerStatusDto) {
    const blockReason = dto.block_reason?.trim();

    if (dto.status === UserStatus.BANNED && !blockReason) {
      throw new BadRequestException(
        'block_reason is required when banning a customer',
      );
    }

    // Admins and other staff cannot be banned through this endpoint.
    const existing = await this.prisma.user.findFirst({
      where: { id, role: UserRole.CLIENT },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Customer not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status: dto.status,
          block_reason:
            dto.status === UserStatus.BANNED ? (blockReason ?? null) : null,
        },
      });

      // Access tokens live 15 minutes; revoking refresh tokens in the same
      // transaction is what makes the ban stick.
      if (dto.status === UserStatus.BANNED) {
        await this.authService.revokeAllRefreshTokens(id, tx);
      }
    });

    return this.findOneForAdmin(id);
  }

  /** user_id -> number of CANCELLED/CLIENTCANCELLED orders. */
  private async countCancelledOrders(
    userIds: number[],
  ): Promise<Map<number, number>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const groups = await this.prisma.order.groupBy({
      by: ['user_id'],
      where: {
        user_id: { in: userIds },
        status: { in: CANCELLED_STATUSES },
      },
      _count: { _all: true },
    });

    return new Map(groups.map((group) => [group.user_id, group._count._all]));
  }
}
