import { Prisma } from '../../generated/prisma/client.js';

export interface OrderResponseSource {
  subtotal: Prisma.Decimal;
  discount_amount: Prisma.Decimal;
  shipping_fee: Prisma.Decimal;
  total_amount: Prisma.Decimal;
  items: Array<{
    unit_price: Prisma.Decimal;
    total_price: Prisma.Decimal;
    [key: string]: unknown;
  }>;
  shippingZone?: {
    shipping_cost: Prisma.Decimal;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Money columns are Decimals; the API exposes them as rounded numbers. */
export function formatOrderResponse(order: OrderResponseSource) {
  return {
    ...order,
    subtotal: Math.round(order.subtotal.toNumber()),
    discount_amount: Math.round(order.discount_amount.toNumber()),
    shipping_fee: Math.round(order.shipping_fee.toNumber()),
    total_amount: Math.round(order.total_amount.toNumber()),
    items: order.items.map((item) => ({
      ...item,
      unit_price: Math.round(item.unit_price.toNumber()),
      total_price: Math.round(item.total_price.toNumber()),
    })),
    shippingZone: order.shippingZone
      ? {
          ...order.shippingZone,
          shipping_cost: Math.round(
            order.shippingZone.shipping_cost.toNumber(),
          ),
        }
      : undefined,
  };
}
