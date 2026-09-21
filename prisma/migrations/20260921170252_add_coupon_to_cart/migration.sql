/*
  Warnings:

  - You are about to alter the column `shipping_cost` on the `ShippingZone` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.

*/
-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "coupon_id" INTEGER;

-- AlterTable
ALTER TABLE "ShippingZone" ALTER COLUMN "shipping_cost" DROP DEFAULT,
ALTER COLUMN "shipping_cost" SET DATA TYPE DECIMAL(10,2);

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
