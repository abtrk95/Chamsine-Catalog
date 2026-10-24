# Minimal Arabic store

A dependency-free, static Arabic RTL storefront. It replaces the original single-file catalog with separate application, presentation, product-data, and order-generation modules.

## Included

- A blank entry screen with only a centered password field. PIN: `0102` (including the leading zero). Four digits submit automatically; Enter also works. Arabic-Indic digits are accepted.
- Generic storefront branding, 229 products, 15 categories, search in Arabic/Danish/SKU, sorting, variant selection, and persistent cart quantities.
- 223 supplied product images optimized to local WebP files, maximum 640 pixels on either side. Total image payload is about 8.8 MB, down from 156.1 MB. No external image host or font/CDN dependency.
- Responsive cards, a mobile cart shortcut, keyboard-accessible modal dialogs, a single cart screen, and no customer-name or notes form.
- Primary action **إرسال الطلب**. A small message icon opens the text fallback.

## Run locally

Serve the extracted folder over HTTP rather than opening `index.html` as a `file://` document:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`. No install or build step is required for the storefront.

## Publish the complete release to GitHub

**This package has not been published.** The current GitHub `main` was left unchanged. A temporary review workflow failed to start and was removed from the review branch. This folder contains the complete replacement, including every image asset.

Install GitHub CLI (`gh`) and authenticate with `gh auth login`, then run from this folder:

```sh
python3 tools/publish.py --push
```

The helper verifies all release checksums, uploads binary images and text files, replaces the old image collection, makes one commit on `catalog-refresh-2026-10-24`, and creates or reuses a pull request. It never force-pushes, merges, writes to the default branch, or changes hosting permissions/settings. Without `--push` it only verifies the package locally. Review the PR and merge it to apply the update; deployment then depends on the repository's configured static hosting.

Alternatively copy this complete folder into a local checkout, remove the previous `images/` collection, commit, and push a review branch. Keep the relative `assets/`, `data/`, and `images/` paths unchanged. GitHub Pages can serve `index.html` and `.nojekyll` from the repository root; no server or admin dashboard is included.

## Password limitations

This is a **convenience screen, not authentication or secure protection**. The PIN and catalog assets are available to someone inspecting the static site. `noindex` is a crawler hint, not access control. Sensitive catalogs require a server or a protected hosting layer.

Unlock state is stored in `sessionStorage`, so normal reloads in the same tab stay unlocked. A new independent tab/session starts locked. Browser session restoration or duplicated tabs can restore/copy session storage; this is not a security boundary. The lock icon explicitly relocks the store. The cart itself stays in `localStorage` and is revalidated against current catalog prices and variants.

## Order sharing

The PDF contains only order date, product name/selected variant, SKU, unit price, per-product total, and an overall total. There is no quantity column, customer information, phone number, store branding, or footer. Quantities are still editable in the cart and drive the line totals. Products without prices say **عند الطلب** and are excluded from the total, which is clearly labeled as the total of available prices.

The file is prepared before the user clicks **إرسال الطلب**, preserving the click activation required by native sharing. Where the browser accepts PDF files through `navigator.share`, the operating system's share sheet opens and the user chooses WhatsApp and a recipient. The site does not auto-select WhatsApp or claim the recipient received anything.

When native file sharing is unavailable, the same button attempts to save the PDF and opens WhatsApp; an Arabic message explicitly tells the user to attach the saved file manually. Browsers may block the download or app handoff. A WhatsApp text link cannot attach a file. Canceling the share sheet keeps the cart intact. No order data is sent to an application server.

Arabic text is shaped by the browser on high-resolution canvas pages and embedded as images in a PDF. This avoids external font downloads and preserves connected Arabic letters. The resulting PDF is visually rendered, **not text-selectable/searchable or a tagged accessible PDF**. Use the small text icon when readable plain text is needed. Real iOS/Android WhatsApp handoff still requires a physical-device test after HTTPS deployment.

## Source data decisions

`tools/source-products.csv` is the supplied primary product export. Its sale price (when present) or regular price is used in DKK, stored as integer øre. The supplied `prices.csv` contains alternate price-list overrides; these were not mixed into the primary DKK list.

All **229** records are included because the request was to import all products, including **8** source records marked `draft`. Missing source data has not been guessed:

- **17** products have no price and display **السعر عند الطلب**.
- **6** products have no SKU. Internal keys are stable `item-ID` values; these are not presented as real SKUs.
- **3** products have no image reference and use a neutral placeholder.

Arabic names/categories and explicit multi-option products are maintained in `tools/localizations.json`. Product brand names remain where they identify the merchandise; Chamsine branding was removed from the storefront identity. The audit in `tools/import-report.json` lists every missing field and source-image checksum. The original uploaded archive is not duplicated in this release.

## Maintain

- `index.html`: semantic page structure and password-only entry.
- `assets/auth.js`: PIN screen and tab-session behavior.
- `assets/core.js`: normalization, money, validated cart state, and text formatting.
- `assets/store.js`: rendering, filters, cart, dialogs, and sharing.
- `assets/order-pdf.js`: paginated Arabic PDF generation.
- `assets/store.css`: responsive minimal design.
- `data/products.json`: the single runtime catalog source.
- `images/`: content-addressed local images.
- `tools/`: source audit, translations, and optional publication helper.

Changing the PIN: edit the `PIN` string and increment `SESSION_KEY` in `assets/auth.js` to invalidate normal saved unlock state. This still does not make static hosting secure. Updating product data: change `data/products.json`, preserve stable IDs, use integer `priceCents` (or `null`), and add the referenced local image. The release manifest intentionally rejects edited packages: after reviewed changes, regenerate it with `python3 tools/make_manifest.py` before using the publisher.

## Tests and verification

```sh
npm test
python3 tools/publish.py
```

No npm dependencies are needed; tests use the built-in Node test runner. See `TESTING.md` for the exact validation coverage and remaining browser/device checks.

Technical references: MDN Navigator.share / Navigator.canShare; GitHub CLI `gh api`; GitHub REST Git trees. Native file sharing requires supported browser/OS behavior and a secure context; a local or embedded preview is not a production sharing test.
