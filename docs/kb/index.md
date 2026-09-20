---
okf_version: "0.2"
---

# table-stakes knowledgebase

* [Architecture](architecture.md) - System architecture, module boundaries, registered-systems seam, and data flow for the Rival Restaurant real-time 1v1/co-op competitive restaurant-management game.
* [Module Map](module-map.md) - Top-level directory-by-directory responsibility map for the table-stakes repo, from shared game data down through server systems, client scenes/UI, harnesses, and scripts.
* [Conventions](conventions.md) - Code style, testing, file organization, naming, and notable patterns actually observed in the table-stakes codebase, cited against OpenSpec decisions where numbered.
* [Key Files](key-files.md) - Entry points and load-bearing files a story-implementing agent will most likely need to read or touch, plus the two hazards that have already cost real work.
* [Copper & Thyme scene integration](copper-and-thyme-integration.md) - How the adapted Copper & Thyme GLB asset composites into RestaurantScene and its 14 harnesses, and where the authoritative layout/rules still live in shared/.
* [Model asset validation](model-asset-validation.md) - Why one bad vertex or material value in a model blacks out the whole restaurant view through the bloom pass, what `npm run check:models` catches, and what to do when adding a .blend or .glb.
* [Stories](stories/index.md) - Sliced user stories from the PRD and their current status, one file per story.
