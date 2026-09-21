/*
  Warnings:

  - You are about to alter the column `shipping_cost` on the `ShippingZone` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,2)` to `Integer`.

*/
-- AlterTable
ALTER TABLE "ShippingZone" ALTER COLUMN "shipping_cost" SET DEFAULT 0,
ALTER COLUMN "shipping_cost" SET DATA TYPE INTEGER;
