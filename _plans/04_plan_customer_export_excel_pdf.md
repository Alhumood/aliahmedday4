# Plan 04: Export Customers to Excel or PDF

**Spec:** [`_specs/04_spec_customer_export_excel_pdf.md`](../_specs/04_spec_customer_export_excel_pdf.md) (approved 2026-10-29, defaults from section 9)
**Status:** Approved (2026-10-29)

## 0. Before starting

- Commit the spec and this plan, so the branch is clean before implementation (`CLAUDE.md` workflow rule).
- **New backend dependencies:** `exceljs`, `pdfkit`, `bidi-js` (puts mixed Arabic/English text in visual order for the PDF; see section 9).
- **New font files** in `backend/src/fonts/`: `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`, `NotoNaskhArabic-Regular.ttf`, `NotoNaskhArabic-Bold.ttf` (SIL Open Font License, so they can be committed). `vercel.json` already bundles `src/**`, so no deployment change is needed.
- No new env vars and no database changes.

## 1. Backend: export module (new `backend/src/export.js`)

1. **Shared helpers**
   - `LABELS = { en: {...}, ar: {...} }`: title, column headers (`id, name, email, phone, owner, created`), "Unassigned", "Exported by", "Search", "Owner", "All", "Page {n} of {m}", "No customers".
   - `columnsFor(user)`: the column list from spec section 4. `owner` only when `user.role === 'admin'`.
   - `fileName(format)`: `customers-YYYY-MM-DD.<ext>`, using today's date.
2. **`buildCustomersXlsx(rows, { user, lang, filters })`** → `Promise<Buffer>`
   - One worksheet "Customers" (`views: [{ state: 'frozen', ySplit: 1, rightToLeft: lang === 'ar' }]`).
   - Bold header row. `customer_id` written as a number, `created_at` as a `Date` with `numFmt: 'yyyy-mm-dd'`, empty strings for missing email/phone, owner falls back to the "Unassigned" label.
   - Column widths: the longest value in each column, between 8 and 50 characters.
   - `workbook.xlsx.writeBuffer()`.
3. **`buildCustomersPdf(rows, { user, lang, filters })`** → `Promise<Buffer>`
   - `new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true })`. Collect the `data` chunks into a Buffer and resolve on `end`.
   - Register the fonts from `src/fonts/` (path from `import.meta.url`). For each piece of text, use the Arabic font if it contains Arabic letters (`/[؀-ۿ]/`), otherwise Noto Sans.
   - A small `drawText(text, x, y, width, align)` helper: for Arabic text, reorder with `bidi-js` before drawing and right-align it. pdfkit's fontkit does the letter joining.
   - Header block: title, export date, "Exported by <name>", and the filters (search text, owner name or "All"/"Unassigned").
   - Table drawn by hand (no table plugin): fixed column widths that fill the page width, header row with a light background, row height from `heightOfString` of the tallest cell, and a new page (with the header row drawn again) when the next row doesn't fit. For `ar` the column order is reversed so the table reads right to left.
   - Empty result: the header row plus a "No customers" line.
   - Footer: after all rows, loop over `bufferedPageRange()` and write "Page n of m" on each page.

## 2. Backend: route (`backend/src/routes/customers.js`)

- Move the existing `sales_user_id` parsing out of `GET /` into a small `ownerFilter(req)` helper that returns `{ salesUserId }` or throws a `400` error, and use it in both routes. Sales users still have it ignored.
- **`GET /export`**, registered **before** `/:id`:
  - `format` must be `xlsx` or `pdf`, otherwise `400 "format must be 'xlsx' or 'pdf'"`. `lang` is `ar` if it equals `ar`, otherwise `en`.
  - `rows = await db.listCustomers(req.user, { name, salesUserId })`.
  - For an admin owner filter that is a user id, read the name with `getUserById` for the PDF header.
  - Build the file, then set `Content-Type` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` or `application/pdf`), `Content-Disposition: attachment; filename="customers-YYYY-MM-DD.<ext>"` and send the buffer.
  - Errors go to `next(err)` as usual.
- `req.user` only has `{ user_id, email, role }`, so read the exporter's name with `db.getUserById(req.user.user_id)`.

## 3. Backend: CORS (`backend/src/app.js`)

- Add `exposedHeaders: ["Content-Disposition"]` to the `cors()` options, so the browser can read the file name from a different origin (the Vercel frontend).

## 4. Backend: Swagger

- JSDoc block above `GET /export` under the **Customers** tag:
  - query parameters `format` (required, enum `xlsx`, `pdf`), `name`, `sales_user_id` (admin only, user id or `none`), `lang` (enum `en`, `ar`);
  - `200` with both content types, `schema: { type: string, format: binary }`, and the `Content-Disposition` header;
  - `400` and `401` (`Unauthorized`).

## 5. Frontend

1. **`api.js`**: a separate `download(path)` function next to `request()`, because the response is a file, not JSON:
   - `fetch` with the bearer token;
   - on `401` with a token, call the unauthorized handler, as `request()` does;
   - on any other error, read the JSON `error` and throw;
   - otherwise return `{ blob, filename }`, with the name parsed from `Content-Disposition` (fallback `customers.<ext>`).
   - `api.exportCustomers({ format, name, salesUserId, lang })` builds the query the same way as `listCustomers`.
   - A small `saveBlob(blob, filename)` helper (object URL + temporary `<a download>` + `revokeObjectURL`).
2. **`CustomersPage.jsx`**:
   - An **Export** dropdown in the toolbar next to **Refresh**: a `<select>` styled like the owner filter, with a placeholder option "Export" and the options "Excel (.xlsx)" and "PDF". Choosing one starts the export and resets the select.
   - It sends `search.trim()`, `owner` (admins only) and the current `lang` from `useI18n()`.
   - `exporting` state disables the control and shows "Exporting…". Errors use the existing `setError`.
3. **`i18n.jsx`**: `export`, `exportExcel`, `exportPdf`, `exporting`, `exportFailed`, in both `en` and `ar`.
4. **`index.css`**: only if the select needs a small tweak; reuse the existing `.select` style.

## 6. Docs

- **`README.md`:** the export endpoint and the new dependencies/fonts.
- **`CLAUDE.md`:** `src/export.js`, that the export reuses `listCustomers` (so `ownerScope()` applies), the `/export` route order before `/:id`, the `exposedHeaders` CORS setting, and `api.download()` in the frontend.

## 7. Verification

There is no test suite, so verify by hand against spec section 8. Test users and customers are removed afterwards, and **your own account and data are not touched.**

1. **curl, as a temporary sales user:** `format=xlsx` and `format=pdf` contain only that user's customers. Adding another user's `sales_user_id` changes nothing. Missing or wrong `format` gives `400`. No token gives `401`.
2. **curl, as a temporary admin:** all customers, filtered by a sales user, and `sales_user_id=none`, each matching `GET /api/customers` with the same filters. A search with no matches gives a file with headers only.
3. **Check the files:** open the xlsx with a short `exceljs` read script (or Numbers) to check the number and date cells, the frozen header, the Owner column only for admins, and RTL for `lang=ar`. Open the PDFs and check the header block, repeated table header, page numbers on a multi-page export, and a customer with an Arabic name in both `en` and `ar`.
4. **Swagger UI:** Authorize, Try it out, and download both formats.
5. **Frontend:** `npm run lint` and `npm run build` pass. In Chrome, export both formats as admin and as sales user, in English and Arabic, with a search and an owner filter. **Before testing in Chrome, check whether you're logged in there, and ask before logging you out.**

## 8. Files changed

- New: `backend/src/export.js`, `backend/src/fonts/*.ttf`, this plan.
- Changed: `backend/package.json` (+ lock), `backend/src/routes/customers.js`, `backend/src/app.js`, `frontend/src/api.js`, `frontend/src/components/CustomersPage.jsx`, `frontend/src/i18n.jsx`, `README.md`, `CLAUDE.md`.

## 9. Risks / notes

- **Arabic in PDFs:** pdfkit joins Arabic letters through fontkit but doesn't reorder right-to-left text, which is why `bidi-js` is used. If mixed Arabic/English lines still come out wrong, the fallback is to draw Arabic cells word by word from the right. This is checked explicitly in step 7.3.
- **Bundle size on Vercel:** the four fonts add about 1–2 MB to the function, well within limits.
- **Large exports:** the whole file is built in memory. Fine at the current data size (spec Q4: no limit for now).
- **Content-Disposition across origins:** without `exposedHeaders` the frontend can't read the file name; the `customers.<ext>` fallback still works.
