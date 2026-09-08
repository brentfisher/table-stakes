# Table Stakes arcade food models

These 26 GLB files are the authored food library integrated into the game: eight finished dishes
and eighteen ingredient props. They are Y-up, measured in meters, use bottom-center pivots, and
contain self-contained PBR materials with no external textures.

Runtime IDs and dimensions are recorded in `shared/game-data/arcade-food.json`. The game uses the
finished dishes at the service pass and carry socket, and shows active-menu ingredients at the
pantry. The `Arcade Food Library` harness previews every model through the same production loader.
