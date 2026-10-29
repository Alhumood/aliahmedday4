import swaggerJsdoc from "swagger-jsdoc";
import { fileURLToPath } from "node:url";

const customerProps = {
  name: { type: "string", example: "Jane Doe" },
  email: { type: "string", nullable: true, example: "jane@example.com" },
  phone: { type: "string", nullable: true, example: "0501234567" },
};

const articleProps = {
  title: { type: "string", example: "Refund policy" },
  category: { type: "string", nullable: true, example: "Policies" },
  content: { type: "string", example: "Customers can request a full refund within 30 days of purchase." },
};

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Customer API",
      version: "1.0.0",
      description: "CRUD REST API for customers and the knowledge bank, plus a Claude-powered natural-language agent endpoint.",
    },
    servers: [{ url: "/", description: "Current host" }],
    components: {
      schemas: {
        Customer: {
          type: "object",
          properties: {
            customer_id: { type: "integer", example: 1 },
            ...customerProps,
            created_at: { type: "string", format: "date-time" },
          },
        },
        CustomerInput: { type: "object", required: ["name"], properties: customerProps },
        CustomerUpdate: { type: "object", properties: customerProps },
        Article: {
          type: "object",
          properties: {
            article_id: { type: "integer", example: 1 },
            ...articleProps,
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        ArticleInput: { type: "object", required: ["title", "content"], properties: articleProps },
        ArticleUpdate: { type: "object", properties: articleProps },
      },
    },
  },
  apis: [fileURLToPath(new URL("./routes/*.js", import.meta.url))],
});
