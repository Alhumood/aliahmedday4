import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import * as db from "./db.js";

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = `You are a customer-data assistant for an internal CRM.
You only have access to the customers assigned to the signed-in sales person; if a customer is not found, say so and do not speculate about other users' data.
Answer questions about customers using the provided tools; never invent customer records.
When the user asks to add or change a customer, call the matching tool, then confirm what was saved.
If a name search returns several matches, list them and ask which one the user means before updating.
For questions about policies, procedures, products or how-tos, search the knowledge bank first and answer from the articles you find, citing the article title. If nothing relevant is found, say so instead of guessing.
Reply in the same language the user writes in (for example Arabic or English).
Keep answers short. Present lists of customers as a Markdown table with id, name, email and phone, with column headers in the reply language.`;

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

// userId always comes from the authenticated request, never from the model's tool input.
async function executeTool(userId, name, input) {
  switch (name) {
    case "get_all_customers":
      return db.listCustomers(userId);
    case "get_customer_by_name":
      if (typeof input.name !== "string" || !input.name.trim()) throw new Error("name is required");
      return db.searchCustomersByName(userId, input.name.trim());
    case "get_customer_by_id":
      if (!Number.isInteger(input.customer_id)) throw new Error("customer_id must be an integer");
      return (await db.getCustomerById(userId, input.customer_id)) ?? { error: "Customer not found" };
    case "add_customer":
      if (typeof input.name !== "string" || !input.name.trim()) throw new Error("name is required");
      return db.createCustomer(userId, { name: input.name.trim(), email: input.email, phone: input.phone });
    case "update_customer":
      if (!Number.isInteger(input.customer_id)) throw new Error("customer_id must be an integer");
      return (
        (await db.updateCustomer(userId, input.customer_id, {
          name: input.name,
          email: input.email,
          phone: input.phone,
        })) ?? { error: "Customer not found" }
      );
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
      system: SYSTEM_PROMPT,
      tools,
      messages,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
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
          const result = await executeTool(user.user_id, block.name, block.input ?? {});
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
