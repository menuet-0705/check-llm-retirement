-- AlterTable
ALTER TABLE "WatchedModel" ADD COLUMN "notifiedPartialKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing and future rows must always expose an array to the application.
ALTER TABLE "WatchedModel" ALTER COLUMN "notifiedPartialKeys" SET NOT NULL;
