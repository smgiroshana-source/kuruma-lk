# Brand logos

Drop official tyre-brand logo files here to replace the generated coloured
badge on product thumbnails (used when a product has no photo).

## How to add a logo

1. Save the logo as `<slug>.png` — a **transparent-background PNG**, roughly
   square, ~200×200px or larger. The `<slug>` must match the brand's `slug`
   field in `src/lib/tyreBrands.ts`.

   Examples: `toyo.png`, `continental.png`, `dunlop.png`, `ceat.png`,
   `gtradial.png`, `three-a.png`, `gri.png`.

2. Add that slug to the `BRANDS_WITH_LOGO` set in `src/lib/tyreBrands.ts`:

   ```ts
   export const BRANDS_WITH_LOGO = new Set<string>([
     'toyo', 'continental', 'dunlop',
   ])
   ```

3. Commit + push. Only brands listed in `BRANDS_WITH_LOGO` load a logo file;
   every other brand keeps its generated colour badge (so there are no broken
   images for brands without a file).

The size (e.g. 205/55R16) is still shown as a strip under the logo.
