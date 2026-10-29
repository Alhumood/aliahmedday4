# Spec 04: Export Customers to Excel or PDF

**Status:** Approved (2026-10-29), with the defaults from section 9
**Date:** 2026-10-29
**Builds on:** [Spec 02: admin account to manage users and their customers](02_spec_admin_user_management.md), [Spec 03: admin user CRUD and job titles](03_spec_admin_user_crud_job_titles.md)

## 1. Background

The Customers page shows a list that can be searched by name and, for admins, filtered by owner. There is no way to take that list out of the app. Users want to download it as an **Excel** file (to work with the data) or a **PDF** file (to print or send).

## 2. Goals

1. On the Customers page, a user can export the customers they are looking at to **Excel (`.xlsx`)** or **PDF**.
2. The export contains **the same rows as the screen**: the current name search and, for admins, the current owner filter.
3. **Access rules don't change.** A sales user can only export their own customers. An admin can export all customers, or filter by owner.
4. The export works in English and Arabic (column headers in the user's language, Arabic text shown correctly, RTL layout for Arabic PDFs).
5. The export endpoint can be tested in the Swagger UI.

## 3. Out of scope

- Exporting knowledge articles, users or job titles.
- Importing customers from Excel.
- CSV and Word formats.
- Exporting from the AI Assistant chat.
- Scheduled or emailed exports.
- Choosing which columns to include.

## 4. Contents of the export

| Column | Sales user | Admin |
|---|---|---|
| ID (`customer_id`) | yes | yes |
| Name | yes | yes |
| Email | yes | yes |
| Phone | yes | yes |
| Owner (`sales_user_name`, or "Unassigned") | no | yes |
| Created (`created_at`, date only) | yes | yes |

- Rows are in the same order as the list (`customer_id`).
- **Excel:** one sheet named "Customers", a bold header row, frozen header, auto-fitted column widths. ID is a number and Created is a real date cell, so they sort and filter correctly in Excel. The sheet is set to right-to-left when the language is Arabic.
- **PDF:** A4, landscape. A title ("Customers"), the export date, who exported it, and the filters used (search text, owner), then a table with the header repeated on each page and page numbers in the footer. Arabic text is shaped and right-to-left.
- **File name:** `customers-YYYY-MM-DD.xlsx` / `customers-YYYY-MM-DD.pdf`.
- An empty result still produces a file, with headers and no rows.

## 5. Backend

### 5.1 Endpoint

| Method | Path | Query | Success | Errors |
|---|---|---|---|---|
| GET | `/api/customers/export` | `format=xlsx\|pdf` (required), `name` (optional), `sales_user_id` (optional, admin only), `lang=en\|ar` (optional, default `en`) | `200` the file, with `Content-Type` for xlsx or pdf and `Content-Disposition: attachment; filename=...` | `400` missing or unknown `format`, `401` |

Notes:
- The rows come from the existing `listCustomers(user, { name, salesUserId })` in `db.js`, so `ownerScope()` applies exactly as for the list. No new SQL.
- `sales_user_id` is **ignored** for sales users (not rejected), as for the list. It takes the same values as the list filter (a user id, or `none` for unassigned).
- The route is registered **before** `/:id` in `customers.js`, like `POST /assign`.
- The file building lives in a new module `src/export.js` (`buildCustomersXlsx(rows, opts)`, `buildCustomersPdf(rows, opts)`), so the route stays thin.
- Proposed libraries (see Q2): `exceljs` for Excel, `pdfkit` for PDF, with an Arabic-capable font file (for example Noto Naskh Arabic + Noto Sans) stored under `backend/src/fonts/`, so the existing `vercel.json` `src/**` bundling includes it.
- Header labels for both languages live in `src/export.js` (the backend has no i18n file).

### 5.2 AI agent

No changes. The agent can't produce files.

## 6. Swagger / OpenAPI

- Add `GET /api/customers/export` under the **Customers** tag, with its query parameters, the `200` response as `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `application/pdf` (`format: binary`), and `400` / `401`.
- The Swagger UI "Try it out" button downloads the file.

## 7. Frontend

- **Customers page:** an **Export** button in the toolbar (next to Refresh) with two choices: **Excel** and **PDF**.
  - It sends the current search text and, for admins, the current owner filter, plus the current UI language.
  - While the file is being made the button is disabled and shows a loading label. Errors show in the existing toast/error area.
- **`api.js`:** a new `exportCustomers({ format, name, owner, lang })` that calls the endpoint with the bearer token, reads the response as a `Blob`, and starts the download with the file name from `Content-Disposition`. A `401` still triggers `onUnauthorized`.
- **Translations:** every new string (`export`, `exportExcel`, `exportPdf`, `exporting`, `exportFailed`) is added to both `en` and `ar`.
- Sales users and admins see the same button. Only the contents differ (the Owner column).

## 8. Acceptance criteria

1. A sales user exports to Excel and to PDF and gets only their own customers. Passing `sales_user_id` of another user changes nothing.
2. An admin exports all customers, then with the owner filter set to a sales user, then to "Unassigned", and each file matches the list on screen.
3. With a search term, the file contains only the matching rows.
4. The Excel file opens in Excel / Google Sheets / Numbers. ID is numeric, Created is a date, and the Owner column appears only for admins.
5. The PDF opens in a normal viewer, shows the title, date, filters and table, repeats the header on every page, and has page numbers.
6. With the UI in Arabic, headers are in Arabic, Arabic customer names display correctly (connected letters, right-to-left), and the layout is RTL.
7. An empty result gives a valid file with headers only.
8. `format` missing or not `xlsx`/`pdf` returns `400`. No token returns `401`.
9. The endpoint works through Swagger **Authorize** and downloads the file.
10. The export works on the deployed Vercel backend (fonts bundled, file size well under the response limit for normal data sizes).

## 9. Decisions

The user approved the defaults on 2026-10-29.

- **Q1: Where are the files made?** **On the backend** (section 5), so access rules are enforced in one place, it can be tested in Swagger, and Arabic PDF fonts are handled server-side. The alternative is to build the files in the browser from the list already loaded, which needs no new endpoint but adds large libraries to the frontend bundle and can't be tested in Swagger.
- **Q2: Libraries:** `exceljs` and `pdfkit` with a bundled Arabic font.
- **Q3: Selection:** export the whole filtered list. Exporting only the rows ticked with the admin bulk-select checkboxes is out of scope for now.
- **Q4: Row limit:** no limit for now. If the customer table grows large, add a cap (for example 10,000 rows) later.
