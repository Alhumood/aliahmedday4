// Builds the customer export files (Excel and PDF). The rows come from db.listCustomers,
// so they are already limited to what the caller may see.
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import bidiFactory from "bidi-js";
import { can } from "./permissions.js";

const FONTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
const bidi = bidiFactory();

export const LABELS = {
  en: {
    title: "Customers",
    sheet: "Customers",
    columns: { id: "ID", name: "Name", email: "Email", phone: "Phone", owner: "Owner", created: "Created" },
    unassigned: "Unassigned",
    all: "All",
    exportedOn: "Exported on",
    exportedBy: "Exported by",
    search: "Search",
    owner: "Owner",
    total: "Total",
    noCustomers: "No customers",
    page: (n, m) => `Page ${n} of ${m}`,
  },
  ar: {
    title: "العملاء",
    sheet: "العملاء",
    columns: { id: "الرقم", name: "الاسم", email: "البريد الإلكتروني", phone: "الهاتف", owner: "المسؤول", created: "تاريخ الإضافة" },
    unassigned: "غير مُسند",
    all: "الكل",
    exportedOn: "تاريخ التصدير",
    exportedBy: "صدّره",
    search: "البحث",
    owner: "المسؤول",
    total: "العدد",
    noCustomers: "لا يوجد عملاء",
    page: (n, m) => `صفحة ${n} من ${m}`,
  },
};

// Column keys with their relative PDF widths. The owner column needs customers.view_all.
const COLUMNS = [
  { key: "id", weight: 0.7 },
  { key: "name", weight: 2.4 },
  { key: "email", weight: 2.6 },
  { key: "phone", weight: 1.4 },
  { key: "owner", weight: 1.7, ownerOnly: true },
  { key: "created", weight: 1.1 },
];

export const CONTENT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const isoDate = (date) => new Date(date).toISOString().slice(0, 10);

export function fileName(format) {
  return `customers-${isoDate(Date.now())}.${format}`;
}

function columnsFor(user) {
  return COLUMNS.filter((c) => !c.ownerOnly || can(user, "customers.view_all"));
}

// The value of a column for one row, as text (PDF) or as a typed cell value (Excel).
function cellValue(row, key, labels) {
  switch (key) {
    case "id": return row.customer_id;
    case "name": return row.name ?? "";
    case "email": return row.email ?? "";
    case "phone": return row.phone ?? "";
    case "owner": return row.sales_user_name ?? labels.unassigned;
    case "created": return row.created_at ? new Date(row.created_at) : null;
  }
}

// Header lines describing the export. filters = { name, ownerLabel } (ownerLabel only with customers.view_all).
function infoLines(labels, exportedBy, filters) {
  const lines = [`${labels.exportedOn}: ${isoDate(Date.now())}`, `${labels.exportedBy}: ${exportedBy}`];
  if (filters.name) lines.push(`${labels.search}: ${filters.name}`);
  if (filters.ownerLabel) lines.push(`${labels.owner}: ${filters.ownerLabel}`);
  return lines;
}

export async function buildCustomersXlsx(rows, { user, lang, exportedBy }) {
  const labels = LABELS[lang];
  const columns = columnsFor(user);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = exportedBy;
  const sheet = workbook.addWorksheet(labels.sheet, {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: lang === "ar" }],
  });

  sheet.columns = columns.map((c) => ({ header: labels.columns[c.key], key: c.key }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, cellValue(row, c.key, labels) || null])));
  }
  sheet.getColumn("created").numFmt = "yyyy-mm-dd";

  // Fit each column to its longest value (dates are always 10 characters).
  for (const c of columns) {
    const lengths = [labels.columns[c.key].length, ...rows.map((r) => {
      const value = cellValue(r, c.key, labels);
      return value instanceof Date ? 10 : String(value ?? "").length;
    })];
    sheet.getColumn(c.key).width = Math.min(50, Math.max(8, Math.max(...lengths) + 2));
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---- PDF -------------------------------------------------------------------------------------

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const FONT_SIZE = 9;
const ROW_HEIGHT = 20;
const CELL_PADDING = 5;

// pdfkit shapes a single Arabic word correctly, but doesn't order words in mixed or multi-word
// right-to-left text. So text is split into words, put in visual order with the Unicode bidi
// levels (rule L2), and each word is drawn on its own with a font that has its letters.
// The direction comes from the first strong letter (like dir="auto"), so phone numbers and
// emails stay left-to-right in the Arabic export.
function visualTokens(text) {
  const { levels } = bidi.getEmbeddingLevels(text);
  const tokens = [];
  for (const match of text.matchAll(/\s+|\S+/g)) {
    tokens.push({ text: match[0], space: /^\s/.test(match[0]), level: levels[match.index] });
  }
  const maxLevel = Math.max(0, ...tokens.map((t) => t.level));
  const minOdd = Math.min(...tokens.map((t) => t.level).filter((l) => l % 2 === 1), Infinity);
  for (let level = maxLevel; level >= minOdd; level--) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].level < level) continue;
      let j = i;
      while (j + 1 < tokens.length && tokens[j + 1].level >= level) j++;
      tokens.splice(i, j - i + 1, ...tokens.slice(i, j + 1).reverse());
      i = j;
    }
  }
  return tokens;
}

function createPdfWriter(doc, rtl) {
  const fontFor = (word, bold) => (ARABIC_RE.test(word) ? "arabic" : "latin") + (bold ? "-bold" : "");

  function measure(text, size, bold) {
    let width = 0;
    for (const token of visualTokens(text)) {
      doc.font(fontFor(token.space ? "" : token.text, bold)).fontSize(size);
      width += doc.widthOfString(token.space ? " ".repeat(token.text.length) : token.text);
    }
    return width;
  }

  // Shorten text with an ellipsis until it fits in maxWidth.
  function fit(text, maxWidth, size, bold) {
    if (measure(text, size, bold) <= maxWidth) return text;
    let chars = Array.from(text);
    while (chars.length > 0 && measure(`${chars.join("").trimEnd()}…`, size, bold) > maxWidth) chars = chars.slice(0, -1);
    return `${chars.join("").trimEnd()}…`;
  }

  // Draw one line of text inside [x, x + width], aligned to the start of the reading direction.
  function line(text, x, y, width, { size = FONT_SIZE, bold = false, color = "#1f2937" } = {}) {
    const fitted = fit(String(text), width, size, bold);
    let cursor = rtl ? x + width - measure(fitted, size, bold) : x;
    doc.fillColor(color);
    for (const token of visualTokens(fitted)) {
      doc.font(fontFor(token.space ? "" : token.text, bold)).fontSize(size);
      const word = token.space ? " ".repeat(token.text.length) : token.text;
      if (!token.space) doc.text(word, cursor, y, { lineBreak: false });
      cursor += doc.widthOfString(word);
    }
  }

  return { line };
}

export function buildCustomersPdf(rows, { user, lang, exportedBy, filters }) {
  const labels = LABELS[lang];
  const rtl = lang === "ar";
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: labels.title } });
  doc.registerFont("latin", path.join(FONTS_DIR, "NotoSans-Regular.ttf"));
  doc.registerFont("latin-bold", path.join(FONTS_DIR, "NotoSans-Bold.ttf"));
  doc.registerFont("arabic", path.join(FONTS_DIR, "NotoNaskhArabic-Regular.ttf"));
  doc.registerFont("arabic-bold", path.join(FONTS_DIR, "NotoNaskhArabic-Bold.ttf"));

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { line } = createPdfWriter(doc, rtl);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 16; // room for the page number

  // Column positions; for Arabic the first column is on the right.
  const columns = columnsFor(user);
  const totalWeight = columns.reduce((sum, c) => sum + c.weight, 0);
  let x = left;
  const placed = columns.map((c) => {
    const w = (c.weight / totalWeight) * width;
    const col = { ...c, w, x };
    x += w;
    return col;
  });
  if (rtl) placed.forEach((c) => { c.x = left + width - (c.x - left) - c.w; });

  // Title and info block.
  let y = doc.page.margins.top;
  line(labels.title, left, y, width, { size: 18, bold: true });
  y += 30;
  for (const text of [...infoLines(labels, exportedBy, filters), `${labels.total}: ${rows.length}`]) {
    line(text, left, y, width, { color: "#4b5563" });
    y += 15;
  }
  y += 10;

  const drawHeader = () => {
    doc.rect(left, y, width, ROW_HEIGHT).fill("#eef2f7");
    for (const c of placed) {
      line(labels.columns[c.key], c.x + CELL_PADDING, y + 4, c.w - 2 * CELL_PADDING, { bold: true });
    }
    y += ROW_HEIGHT;
  };
  drawHeader();

  if (rows.length === 0) {
    line(labels.noCustomers, left + CELL_PADDING, y + 4, width - 2 * CELL_PADDING, { color: "#6b7280" });
  }
  for (const row of rows) {
    if (y + ROW_HEIGHT > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    for (const c of placed) {
      const value = cellValue(row, c.key, labels);
      const text = value instanceof Date ? isoDate(value) : String(value ?? "");
      line(text, c.x + CELL_PADDING, y + 4, c.w - 2 * CELL_PADDING);
    }
    doc.moveTo(left, y + ROW_HEIGHT).lineTo(left + width, y + ROW_HEIGHT).lineWidth(0.5).stroke("#e5e7eb");
    y += ROW_HEIGHT;
  }

  // Page numbers. The bottom margin is lifted so pdfkit doesn't start a new page for the footer.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    line(labels.page(i + 1, range.count), left, doc.page.height - 30, width, { size: 8, color: "#6b7280" });
  }

  doc.end();
  return done;
}
