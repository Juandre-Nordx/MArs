# Railway deployment

## Single-service deployment

1. Add a Railway service from this GitHub repository with the **repository root** as its root directory. It uses the root Dockerfile and `railway.json`.
2. Clear stale custom build/start command overrides so the Dockerfile command runs. Railway's health check must be `/api/health`, matching the committed configuration.
3. Deploy. The build installs dependencies, generates Prisma and compiles all workspaces. The container starts `node apps/api/dist/index.js`, validates production web assets, and serves the API/game on `0.0.0.0:$PORT`. `WEB_ROOT` is set in the Dockerfile. Startup does not run migrations.
4. Generate a public domain and check `/`, the referenced JavaScript asset, `/api/health`, then create a new game. Inspect deployment logs for `startup_begin`, `startup_configuration` and `startup_complete`. Startup failures log `startup_failed` to stderr and exit 1.
5. PostgreSQL is optional for current browser-local gameplay. For database-backed readiness/session foundations, add PostgreSQL, reference its private `DATABASE_URL`, and explicitly apply committed migrations with `npm run db:migrate` in a controlled Railway shell/job. Do not commit credentials. Check `/api/ready` separately; it returns 503 when the database is missing or unavailable. Authentication storage also fails explicitly when unavailable. Use a single migration job for multiple replicas.

V0.4 provides administrator login and catalogue publication at `/admin`; player registration and cloud saves remain unavailable. Apply the committed migrations in a controlled job, set `ADMIN_ORIGIN` to the exact public HTTPS origin, and create the initial administrator through the private-stdin CLI. See [V0.4 operator commands and configuration](V0.4.md). No automatic seed or migration runs during HTTP startup.

## Railway split services and artwork volume

Use repository root as the source root for both services.

1. Keep **Postgres** and its existing volume. Back up the database before applying the committed Prisma migrations with the existing controlled migration job. The asset-storage migration adds backend and key metadata. Existing rows keep their bytes and their IDs. No media migration is required.
2. Configure **`@mars/api`** with the existing `railway.json` and root Dockerfile. Attach a new volume to this service at **`/data/uploads`**. Set these runtime variables on the API service:

   ```dotenv
   ASSET_STORAGE_DRIVER=volume
   ASSET_STORAGE_PATH=/data/uploads
   HOST=::
   PORT=3001
   ADMIN_ORIGIN=https://<public-web-domain>
   ```

   The optional API variables `ADMIN_UPLOAD_INPUT_LIMIT_BYTES` and `ADMIN_UPLOAD_OUTPUT_LIMIT_BYTES` default to 8 MiB input and 2 MiB processed PNG. An existing `ADMIN_UPLOAD_LIMIT_BYTES` setting remains an output-only limit when the new output variable is unset. Update the API before the web service so the editor can display the configured limits. [Upload limits](V0.4.md)

   Keep the existing private `DATABASE_URL` reference. Binding to `::` supports Railway private networking on environments with IPv6 private DNS. Use **one API replica** with this volume. The volume belongs to a single Railway service instance and a replacement must mount the same volume. A replacement can briefly interrupt access while Railway reattaches it.

3. Configure **`@mars/web`** with config file path **`/railway.web.json`**. It selects `Dockerfile.web`, which builds the frontend and serves it using Caddy. Set `MARS_API_UPSTREAM=http://<api-private-host>:3001` on the web service using the API service’s actual Railway private domain. The browser uses same-origin URLs. Caddy forwards `/api/*` to the API, including uploads, protected previews and published artwork. Expose the web domain publicly and use it as the exact API `ADMIN_ORIGIN`. The web service has no artwork volume.
4. From the web domain, check `/api/health` and `/api/ready`, sign in at `/admin`, and verify a protected preview or an existing published asset URL. In an isolated staging environment, upload artwork, save the definition, validate and publish, and verify that the same published URL returns the same bytes after an API replacement.

The mount root must already exist. The API process needs read, write and directory traversal access to it. It creates **`/data/uploads/catalogue-assets/`** on the first upload, with mode `0750` and files with mode `0640` subject to the process umask. Restore ownership and permissions for the API runtime identity. Railway mounts the volume at runtime. The Docker build and application startup leave it untouched. On Railway, volume mode requires `RAILWAY_VOLUME_MOUNT_PATH` to match `ASSET_STORAGE_PATH`.

**Failure behavior.** The database-backed driver remains the default when the driver variable is unset. In volume mode, a missing mount, unwritable directory or failed write yields an explicit upload error. The API does not fall back to another driver. Missing published files return 404 and unreadable or corrupt files return 503. The browser shows placeholder artwork and keeps the pinned reference. HTTP health and browser-local gameplay stay available, and `/api/ready` still reports database connectivity. Volume reads are selected by each asset’s database row, so a move to database-backed uploads still requires mounting the volume for existing volume assets.

**Backup and recovery.** Pause catalogue changes and uploads while taking coordinated backups of the complete PostgreSQL database and the entire artwork volume. Preserve published rows, legacy image bytes, filenames and file contents. Restore the database and matching volume backup to the API service before resuming uploads. Check health, database readiness and a sample of legacy and volume URLs against the backed-up files or stored SHA-256 values. Preserve browser-save backups separately. After writes begin in volume mode, roll back only to a build that understands volume records if those images must remain available.

An interrupted upload can leave a dot-prefixed `.part` file. A failed database commit can leave a complete PNG without a matching row. Neither is exposed by the API, which requires a database row and public publication membership. The service retains files when commit status is uncertain. If operators reclaim disk space, pause uploads, back up both stores, and reconcile filenames against **every** `CatalogueAsset.storageKey`, including unsaved uploads and historical publications. Remove only confirmed unreferenced files after review. There is no automated cleanup.

See [Railway volumes](https://docs.railway.com/volumes) and [private networking](https://docs.railway.com/networking/private-networking).

The JavaScript Prisma client and isolated PostgreSQL integration were verified locally. The migration CLI's native schema-engine download remains blocked by this managed environment; no live Railway migration/rollout was performed. The [startup fix report](RAILWAY-STARTUP-FIX.md) remains historical context.

Run `npm run test:production` to build and test the real production entry point, including absent/invalid database settings and explicit fatal startup diagnostics. CI also attempts the full Docker build. The deployment Dockerfile uses plain RUN instructions: Railway's reported builder rejects secret mounts. Keep environment-specific proxy certificate setup out of this deployment file; normal Railway builds require no session CA.

V0.4 edits supported definitions; it does not supply every planned industry system. See [implemented capabilities and limitations](V0.4.md).
