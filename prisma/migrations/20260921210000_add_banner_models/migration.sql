-- CreateEnum
CREATE TYPE "BannerActionType" AS ENUM ('NONE', 'CATEGORY', 'PRODUCT', 'BRAND', 'FILTER', 'PAGE');

-- CreateTable
CREATE TABLE "Banner" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerImage" (
    "id" SERIAL NOT NULL,
    "banner_id" INTEGER NOT NULL,
    "image_url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "click_action_type" "BannerActionType" NOT NULL DEFAULT 'NONE',
    "click_target_id" INTEGER,
    "click_target_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannerImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BannerImage_banner_id_idx" ON "BannerImage"("banner_id");

-- AddForeignKey
ALTER TABLE "BannerImage" ADD CONSTRAINT "BannerImage_banner_id_fkey"
    FOREIGN KEY ("banner_id") REFERENCES "Banner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
