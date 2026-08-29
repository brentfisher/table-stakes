# Asset licenses

Every reused external asset must have a metadata file here before it ships.

PRD §23 lists asset licensing as a named risk; the mitigation is this directory.
Prefer CC0 or otherwise commercial-friendly licenses.

One `<asset-name>.json` per asset:

```json
{
  "asset": "models/low-poly-table.glb",
  "source": "https://example.com/asset-page",
  "author": "Author Name",
  "license": "CC0-1.0",
  "attributionRequired": false,
  "attributionText": null,
  "retrieved": "2026-08-28"
}
```
