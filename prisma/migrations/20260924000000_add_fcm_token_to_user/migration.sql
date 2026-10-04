-- Store the current Firebase Cloud Messaging device token for push notifications.
ALTER TABLE "User"
ADD COLUMN "fcm_token" TEXT;
