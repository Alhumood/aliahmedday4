// Deal stages, the app currency and the input checks shared by the deal routes and the AI agent (spec 05).
export const DEAL_STAGES = ["lead", "qualified", "proposal", "won", "lost"];
export const CLOSED_STAGES = ["won", "lost"];
export const OPEN_STAGES = DEAL_STAGES.filter((stage) => !CLOSED_STAGES.includes(stage));
export const APP_CURRENCY = "INR";

const MAX_TITLE = 200;
const MAX_AMOUNT = 999999999999.99;

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Validates a create (partial = false) or update (partial = true) body and returns only the fields present,
// in camelCase. Unknown fields are ignored. Throws a 400 error on invalid input.
export function readDeal(body, { partial = false } = {}) {
  const input = body ?? {};
  const deal = {};
  const has = (key) => input[key] !== undefined;

  if (has("customer_id")) {
    if (!isPositiveInt(input.customer_id)) throw badRequest("customer_id must be a positive integer");
    deal.customerId = input.customer_id;
  } else if (!partial) throw badRequest("customer_id is required");

  if (has("title")) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > MAX_TITLE) throw badRequest(`title must be 1-${MAX_TITLE} characters`);
    deal.title = title;
  } else if (!partial) throw badRequest("title is required");

  if (has("amount")) {
    const { amount } = input;
    const cents = amount * 100;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
      throw badRequest("amount must be a number of 0 or more");
    }
    if (Math.abs(cents - Math.round(cents)) > 1e-6) throw badRequest("amount can have at most 2 decimals");
    deal.amount = amount;
  } else if (!partial) throw badRequest("amount is required");

  if (has("stage")) {
    if (!DEAL_STAGES.includes(input.stage)) throw badRequest(`stage must be one of: ${DEAL_STAGES.join(", ")}`);
    deal.stage = input.stage;
  }

  if (has("expected_close_date")) {
    const date = input.expected_close_date;
    if (date !== null && date !== "" && !isDate(date)) throw badRequest("expected_close_date must be a date (YYYY-MM-DD)");
    deal.expectedCloseDate = date || null;
  }

  return deal;
}

// List filters: customer_id, stage (a stage key, "open" or "closed") and title search.
export function readDealFilters({ customer_id: customerId, stage, title } = {}) {
  const filters = {};
  if (customerId !== undefined && customerId !== "") {
    const id = Number(customerId);
    if (!isPositiveInt(id)) throw badRequest("customer_id must be a positive integer");
    filters.customerId = id;
  }
  if (stage !== undefined && stage !== "") {
    if (stage !== "open" && stage !== "closed" && !DEAL_STAGES.includes(stage)) {
      throw badRequest(`stage must be open, closed or one of: ${DEAL_STAGES.join(", ")}`);
    }
    filters.stage = stage;
  }
  if (typeof title === "string" && title.trim()) filters.title = title.trim();
  return filters;
}
