ALTER TABLE "CatalogueAsset"
  ALTER COLUMN "data" DROP NOT NULL,
  ADD COLUMN "storageBackend" TEXT NOT NULL DEFAULT 'database',
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "byteSize" INTEGER,
  ADD CONSTRAINT "CatalogueAsset_storage_check" CHECK (
    ("storageBackend" = 'database' AND "storageKey" IS NULL AND "data" IS NOT NULL)
    OR
    ("storageBackend" = 'volume' AND "storageKey" IS NOT NULL
      AND "storageKey" = "id"::text || '.png' AND "data" IS NULL
      AND "byteSize" IS NOT NULL AND "byteSize" BETWEEN 1 AND 8388608)
  );
