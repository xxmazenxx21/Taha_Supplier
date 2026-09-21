-- CreateTable: ShippingZone
CREATE TABLE "ShippingZone" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "shipping_cost" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique name
CREATE UNIQUE INDEX "ShippingZone_name_key" ON "ShippingZone"("name");

-- AlterTable: add shipping_zone_id + shipping_fee to Order
ALTER TABLE "Order"
    ADD COLUMN "shipping_zone_id" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "shipping_fee" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Remove the default after adding column so future rows require explicit value
ALTER TABLE "Order" ALTER COLUMN "shipping_zone_id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shipping_zone_id_fkey" FOREIGN KEY ("shipping_zone_id") REFERENCES "ShippingZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
