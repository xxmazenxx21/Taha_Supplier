-- Allow one user to register multiple Firebase devices.
CREATE TABLE "UserDevice" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- Preserve tokens created by the previous single-token implementation.
INSERT INTO "UserDevice" ("user_id", "token", "platform", "created_at", "updated_at")
SELECT DISTINCT ON ("fcm_token")
    "id",
    "fcm_token",
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
WHERE "fcm_token" IS NOT NULL
  AND BTRIM("fcm_token") <> ''
ORDER BY "fcm_token", "id";

CREATE UNIQUE INDEX "UserDevice_token_key" ON "UserDevice"("token");
CREATE INDEX "UserDevice_user_id_idx" ON "UserDevice"("user_id");

ALTER TABLE "UserDevice"
ADD CONSTRAINT "UserDevice_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User"
DROP COLUMN "fcm_token";
