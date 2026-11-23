# Perspective map

The game uses a single Three.js perspective renderer. The HUD, simulation clock, resource and utility systems, and catalogue administration keep their existing command paths.

## Controls

| Control             | Action                                                      |
| ------------------- | ----------------------------------------------------------- |
| WASD or middle drag | Pan over terrain                                            |
| Right drag          | Orbit through 360° and adjust tilt                          |
| Mouse wheel         | Zoom within the perspective camera's near and far limits    |
| Left click          | Pick a building, resident, or terrain tile                  |
| Focus building      | Move the camera to the selected building's footprint center |
| R or Rotate model   | Rotate the placement preview in 90° steps                   |
| Esc or right click  | Cancel placement or a utility route                         |

The camera moves above the rendered terrain. It uses the current chunk's height when level of detail changes. **Balanced** shows up to 49 chunks with shadows and nearby rocks. **Low** shows up to 25 chunks and skips dynamic shadows and decorative rock instances. WebGL 2 is needed for the map. **Retry 3D map** recreates the canvas after a context interruption.

## Placement and saved colonies

Pointer rays intersect the terrain mesh. The resulting world X and Z snap to logical tile X and Y. Placement shows the 3D model and footprint with valid and invalid colors. A foundation uses the local terrain grade, and the existing construction command handles costs, collision, and access.

The optional `modelYaw` property persists a building's visual angle. It leaves gameplay footprints, ports, and networks at their saved coordinates. Schema-8 browser saves and prior load migrations remain supported. Older saves without an angle render at 0°. Refining, cargo logistics, and research remain at their previous implementation status.

The game uses the latest published GLB settings and state animations by building ID. The procedural model covers buildings whose GLB is unavailable. The existing building editor keeps icon uploads for panels and 3D model controls for the map. Historical sprite records and files remain available for saves, catalogue publications, and rollback. [Building models](BUILDING-MODELS.md)

## Rollback and deployment

`backup/pre-perspective-only` preserves the game and building editor before the renderer removal. Use a save made before the change when rolling back the renderer. The Railway Dockerfiles and service configuration are shared with the previous build. If deploying GLB support together with this change, apply the existing model asset migration before the API rollout. [Railway setup](RAILWAY.md)
