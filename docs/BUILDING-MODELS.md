# Building models and animation

Open **Industry Buildings** in the existing admin catalogue. Edit a building such as **Water storage tank**, then expand **3D Model and Animations**.

1. Upload a binary glTF 2.0 file with the `.glb` extension. The private preview shows the model on the building footprint. Drag to orbit, scroll to zoom, or choose **Frame model**.
2. Set a uniform scale, a position offset in tile units, and an X/Y/Z rotation in degrees. With **Ground alignment** enabled, the transformed model is centered on the footprint and the bottom of its transformed bounds meets the top of the foundation. Position offsets apply after alignment. The preview reports the dimensions of the scaled and rotated bounds.
3. Select a simulated state in **Animations**. Assign an embedded clip, built-in motion, or **None** to each state. **Play**, **Pause**, and **Reset** only affect the editor preview. Built-in motion supports rotation, vertical or horizontal oscillation, and emissive pulsing. Use **Model part** to restrict the effect to a named node and its descendants. Speed is an embedded clip multiplier or built-in cycles per second. Travel distance is in model units before scaling.
4. Choose **Save Model Settings** to save the building draft. **Publish** validates and publishes the saved catalogue draft, including other saved edits. Uploading by itself keeps the model private.
5. Reopen **3D preview** or refresh the game to load the published visuals. The 3D view also checks for new visuals when its window regains focus. **Reset to default model** restores the procedural building after the reset is saved and published. A failed load falls back to that same procedural model.

The 3D scene uses the configured **Construction** state for its entrance animation after placement, **Damaged** for buildings below full health, **Working** when the simulation reports `running`, and **Idle** otherwise. A state without an assignment shows the model at rest. Pausing the simulation freezes building playback after the construction entrance. A replacement retains the transform and clears assignments so clip and node indexes are chosen for the new model.

Published 3D visuals apply by stable building ID. Existing colonies keep their saved building IDs, catalogue IDs, footprints, coordinates, inventories and simulation behavior. The isometric icons and sprites still follow the colony's pinned catalogue.

## Export and storage

Export one scene as uncompressed **glTF Binary (.glb)**. Pack all textures and buffers in the file. The server accepts up to 8 MiB, with embedded still PNG or JPEG textures up to 4096 pixels per side and a combined 16-megapixel budget. It also bounds node, mesh, accessor, and animation complexity and validates the binary with Khronos glTF Validator. External resources and compressed Draco, Meshopt, and KTX textures are unsupported.

The existing catalogue draft and published version documents store the model reference, transform, and animation settings. GLB bytes use the configured catalogue asset backend. Railway volume mode uses `/data/uploads/catalogue-assets/<UUID>.glb`. Existing PNG paths and legacy PostgreSQL-backed images retain their original identifiers. Each replacement receives a new asset ID and published historical references remain readable.

Before rolling out the API, apply Prisma migration `202611230001_building_model_assets` using the existing migration job. It extends the existing volume-key constraint to allow GLB filenames. Back up PostgreSQL and the API volume together as described in the [Railway deployment guide](RAILWAY.md).
