ALTER TABLE "CatalogueAsset"
  DROP CONSTRAINT "CatalogueAsset_storage_check",
  ADD CONSTRAINT "CatalogueAsset_storage_check" CHECK (
    ("storageBackend" = 'database' AND "storageKey" IS NULL AND "data" IS NOT NULL)
    OR
    ("storageBackend" = 'volume' AND "storageKey" IS NOT NULL
      AND "storageKey" = "id"::text || CASE WHEN "mime" = 'model/gltf-binary' THEN '.glb' ELSE '.png' END
      AND "data" IS NULL
      AND "byteSize" IS NOT NULL AND "byteSize" BETWEEN 1 AND 8388608)
  );
