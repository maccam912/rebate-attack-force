# PNG map authoring

The PNG is the source of truth for both art and solid terrain. Open any of the three images in `public/maps/` in an image editor, or save a new PNG there under a unique lowercase, hyphenated filename. The filename without `.png` becomes the map ID.

## The alpha rule

- Alpha **255**: solid ground, wall, ceiling, or platform, regardless of RGB color.
- Alpha **0–254**: background/scenery, with no collision. Even 254 is pass-through.
- One pixel is one world unit. The image dimensions set the arena dimensions.
- Curves, holes, overhangs, thin walls, and separate islands are all supported.
- Antialiasing is allowed: only the fully opaque interior is solid.
- Keep decorative grass, glows, clouds, and background details below 255 in the **exported image**, including where layers overlap. Do not flatten onto an opaque background.

The browser displays the original PNG, including translucent scenery, over the theme's backdrop. Previews use the same image. Existing legacy maps continue to work.

## Safe starting positions

The compiler finds individually supported frog positions on the image and groups six nearby positions into each team area. They can be on rolling ground or separate branches at different heights; **there is no flat-platform requirement**. Provide at least two sheltered areas with enough room for six frogs, 42 pixels of headroom, and 44 pixels between frog centers. The compiler rejects maps without enough stable starting space. Spawns stay at least 60 pixels below the image top and 24 pixels above water. Crates and mines also use stable, exposed surfaces detected from the PNG.

The engine samples the terrain silhouette over 24 pixels to distinguish real slopes from raster stair steps. Slopes above a rise/run ratio of 0.75 (about 37°) send frogs sliding downhill, even when they try to walk uphill. Sharp symmetric peaks also shed frogs; they are not safe standing or jumping surfaces. Gentle ground remains walkable, and branch forks can catch falling frogs. Geometry alone determines this behavior—there is no extra slope mask or per-map slippery flag.

The compiler selects up to four team areas, then repeats the image horizontally for larger rosters. Maps may be up to 8192 × 4096 pixels. A few connected land masses or branching trees are much cheaper than millions of isolated opaque specks.

## Build and play

1. Save the PNG in `public/maps/`.
2. Optionally add an entry to `public/maps/catalog.json`, keyed by its filename without the extension:

   ```json
   {
     "my-map": {
       "name": "My Map",
       "description": "Curving cliffs and secret tunnels.",
       "size": "Medium",
       "theme": "islands",
       "waterY": 1330
     }
   }
   ```

   Merge this entry with the existing entries. Omit `waterY` for a dry map. Themes are `scrapyard`, `yard`, `cave`, `jungle`, and `islands`; sizes are `Small`, `Medium`, and `Large`. Missing entries get a name from the filename and a dry island backdrop.
3. Run `npm run maps:compile`. Restart a running match to use the updated terrain. Dev servers hot-reload the generated module when you compile it.
4. Select the new map in practice, local play, or the online lobby.

Compilation also runs before `npm run dev`, `npm run dev:client`, `npm run dev:server`, `npm run build`, and `npm test`. Commit the PNG and `shared/image-maps.generated.ts` together. The production server uses the generated module, so it does not need a browser or PNG decoder. Deploy the client and server from the same build; image hashes detect mismatched multiplayer maps.

The compiler turns horizontal opaque runs into lossless rectangles and merges identical runs vertically. These are acceleration data only, not authored geometry: their union is exactly the alpha-255 pixels, and they are never drawn as rectangular platforms. A spatial index keeps body, projectile, and rope queries local. Rope routing uses a bounded local visibility graph and checks every segment against the exact terrain; exceptionally intricate shapes may prevent a wrap, releasing the rope rather than passing through solid terrain. Static collision geometry is reconstructed from the compiled catalog on multiplayer clients rather than resent every snapshot.

## Bundled artwork

- **Mossback Woods (safer):** 3200 × 1850, solid trees with branching limbs and forks, translucent foliage, and a forgiving dry forest floor.
- **Razorback Range (dangerous):** 3600 × 2000, connected mountains with knife-edge summits, steep sliding faces, safe foothills, and flooded gullies.
- **Moonwell Sinkhole (very dangerous):** 2600 × 2200, a deep flooded vertical chasm with eroded wall pockets, a sagging root crossing, and broken lower crossings.

The PNG filenames/map IDs (`mossback-grotto`, `amber-arches`, `mooncap-garden`) are retained so saved map selections still resolve after the redesign. The picker shows the new names and risk levels.

`scripts/paint-maps.mjs` is the reproducible Canvas source for the initial artwork. `npm run maps:paint` explicitly recreates those three PNGs; ordinary compilation never repaints them or discards image-editor changes.
