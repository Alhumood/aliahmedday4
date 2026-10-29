import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import * as db from "./db.js";
import { can } from "./permissions.js";
import { DEAL_STAGES, readDeal, readDealFilters } from "./deals.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const EFFORT = process.env.AGENT_EFFORT || "low";
// Server-side refusal fallback is only available on these models (Haiku 5.5 has none).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const fallbackParams = FALLBACK_MODELS.has(MODEL)
  ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
  : {};
const MAX_TOOL_ROUNDS = 8;

const ACCESS_RULES = {
  own: "You only have access to the customers assigned to the signed-in user; if a customer is not found, say so and do not speculate about other users' data.",
  all: "You are assisting a user who can see every customer; mention the owner (sales_user_name) when listing customers, and 'Unassigned' when there is none. Customers you add are created unassigned, and you cannot change a customer's owner.",
};

const seesAll = (user) => can(user, "customers.view_all");

// Rebuilt on every call from the current permissions, so a role change applies to existing conversations.
const systemPrompt = (user) => `You are a customer-data assistant for an internal CRM.
${seesAll(user) ? ACCESS_RULES.all : ACCESS_RULES.own}
Answer questions about customers using the provided tools; never invent customer records.
When the user asks to add or change a customer, call the matching tool, then confirm what was saved.
If a name search returns several matches, list them and ask which one the user means before updating.
For questions about policies, procedures, products or how-tos, search the knowledge bank first and answer from the articles you find, citing the article title. If nothing relevant is found, say so instead of guessing.
Reply in the same language the user writes in (for example Arabic or English).
Keep answers short. Present lists of customers as a Markdown table with id, name, email and phone${seesAll(user) ? " and owner" : ""}, with column headers in the reply language.
Deals are sales opportunities with one customer. Their stages, in the usual order, are lead, qualified, proposal, then won or lost; any stage can be set at any time. You can see a customer's deals exactly when you can see the customer. Amounts are in Indian rupees: show them as ₹ with Indian digit grouping (for example ₹1,50,000). When the user asks to add a deal or change its stage, amount, title or expected close date, call the matching tool and confirm what was saved. You cannot delete deals; tell the user to do it in the app. Present lists of deals as a Markdown table with id, title, customer, amount, stage and expected close date, with column headers and stage names in the reply language.`;

const tools = [
  {
    name: "get_all_customers",
    description: "Return every customer in the database.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_customer_by_name",
    description: "Find customers whose name contains the given text (case-insensitive).",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Full or partial customer name" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "get_customer_by_id",
    description: "Return one customer by numeric customer_id.",
    input_schema: {
      type: "object",
      properties: { customer_id: { type: "integer" } },
      required: ["customer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_customer",
    description: "Create a new customer. Only name is required.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_customer",
    description: "Update name, email and/or phone of an existing customer by customer_id. Omitted fields are left unchanged.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "integer" },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
      },
      required: ["customer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_deals",
    description: "List deals, newest first. All filters are optional: a customer, a stage (or open / closed), and a partial title match.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "integer" },
        stage: { type: "string", enum: [...DEAL_STAGES, "open", "closed"], description: "open = lead, qualified, proposal; closed = won, lost" },
        title: { type: "string", description: "Full or partial deal title" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "add_deal",
    description: "Create a deal for a customer. The stage defaults to lead.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "integer" },
        title: { type: "string" },
        amount: { type: "number", description: "In Indian rupees, 0 or more, at most 2 decimals" },
        stage: { type: "string", enum: DEAL_STAGES },
        expected_close_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["customer_id", "title", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "update_deal",
    description: "Update a deal by deal_id: stage, title, amount, expected close date or customer. Omitted fields are left unchanged.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "integer" },
        customer_id: { type: "integer" },
        title: { type: "string" },
        amount: { type: "number" },
        stage: { type: "string", enum: DEAL_STAGES },
        expected_close_date: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear it" },
      },
      required: ["deal_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_knowledge",
    description: "Search the knowledge bank (policies, procedures, FAQs, product info) by keyword. Matches title, category and content. Use short keywords, not full sentences.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Keyword or short phrase" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_knowledge_articles",
    description: "Return every article in the knowledge bank. Use when a keyword search finds nothing or the user asks what articles exist.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// user (id and permissions) always comes from the authenticated request, never from the model's tool input.
async function executeTool(user, name, input) {
  switch (name) {
    case "get_all_customers":
      return db.listCustomers(user);
    case "get_customer_by_name":
      if (typeof input.name !== "string" || !input.name.trim()) throw new Error("name is required");
      return db.listCustomers(user, { name: input.name.trim() });
    case "get_customer_by_id":
      if (!Number.isInteger(input.customer_id)) throw new Error("customer_id must be an integer");
      return (await db.getCustomerById(user, input.customer_id)) ?? { error: "Customer not found" };
    case "add_customer":
      if (typeof input.name !== "string" || !input.name.trim()) throw new Error("name is required");
      return db.createCustomer(user, { name: input.name.trim(), email: input.email, phone: input.phone });
    case "update_customer":
      if (!Number.isInteger(input.customer_id)) throw new Error("customer_id must be an integer");
      return (
        (await db.updateCustomer(user, input.customer_id, {
          name: input.name,
          email: input.email,
          phone: input.phone,
        })) ?? { error: "Customer not found" }
      );
    case "search_deals":
      return db.listDeals(user, readDealFilters(input));
    case "add_deal":
      return db.createDeal(user, readDeal(input));
    case "update_deal": {
      if (!Number.isInteger(input.deal_id)) throw new Error("deal_id must be an integer");
      const { deal_id: dealId, ...fields } = input;
      return (await db.updateDeal(user, dealId, readDeal(fields, { partial: true }))) ?? { error: "Deal not found" };
    }
    case "search_knowledge":
      if (typeof input.query !== "string" || !input.query.trim()) throw new Error("query is required");
      return db.searchArticles(input.query.trim());
    case "list_knowledge_articles":
      return db.listArticles();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error("ANTHROPIC_API_KEY is not set in backend/.env");
    err.status = 503;
    throw err;
  }
  client ??= new Anthropic();
  return client;
}

// Conversation history is kept server-side and only ever appended to, so
// assistant turns (including thinking blocks) are replayed unchanged.
// Each conversation belongs to the user who started it.
const conversations = new Map();

export async function chat(user, message, conversationId) {
  const anthropic = getClient();
  const existing = conversationId && conversations.get(conversationId);
  const id = existing?.userId === user.user_id ? conversationId : randomUUID();
  if (id !== conversationId) conversations.set(id, { userId: user.user_id, messages: [] });
  const { messages } = conversations.get(id);

  messages.push({ role: "user", content: message });
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt(user),
      tools,
      messages,
      output_config: { effort: EFFORT },
      ...fallbackParams,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      return { conversationId: id, reply: "Sorry, I can't help with that request.", toolCalls };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { conversationId: id, reply, toolCalls };
    }

    const results = await Promise.all(
      toolUses.map(async (block) => {
        toolCalls.push({ name: block.name, input: block.input });
        try {
          const result = await executeTool(user, block.name, block.input ?? {});
          return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: block.id, content: err.message, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  return { conversationId: id, reply: "I stopped after too many tool calls. Please rephrase your request.", toolCalls };
}

export function resetConversation(userId, conversationId) {
  if (conversations.get(conversationId)?.userId === userId) conversations.delete(conversationId);
}
