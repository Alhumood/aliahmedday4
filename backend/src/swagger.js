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
      description: [
        "CRUD REST API for customers and the knowledge bank, plus a Claude-powered natural-language agent endpoint.",
        "",
        "**Authentication:** every endpoint except `/api/auth/register` and `/api/auth/login` requires a JWT.",
        "Each sales user only sees and changes the customers assigned to them; other users' customers return 404.",
        "",
        "**Testing here:** call `POST /api/auth/register` (or `/login`), copy the `token` from the response,",
        "click **Authorize**, paste it, then try the Customers and Agent endpoints.",
      ].join("\n"),
    },
    servers: [{ url: "/", description: "Current host" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      responses: {
        Unauthorized: {
          description: "Missing, invalid or expired token",
          content: {
            "application/json": {
              schema: { type: "object", properties: { error: { type: "string", example: "Authentication required" } } },
            },
          },
        },
      },
      schemas: {
        RegisterInput: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string", example: "Sara Sales" },
            email: { type: "string", format: "email", example: "sara@example.com" },
            password: { type: "string", format: "password", minLength: 8, example: "password123" },
          },
        },
        LoginInput: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email", example: "sara@example.com" },
            password: { type: "string", format: "password", example: "password123" },
          },
        },
        User: {
          type: "object",
          properties: {
            user_id: { type: "integer", example: 1 },
            name: { type: "string", example: "Sara Sales" },
            email: { type: "string", example: "sara@example.com" },
            role: { type: "string", example: "sales" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            user: { $ref: "#/components/schemas/User" },
            token: { type: "string", description: "JWT, valid for 8 hours. Paste it into Authorize." },
          },
        },
        Customer: {
          type: "object",
          properties: {
            customer_id: { type: "integer", example: 1 },
            ...customerProps,
            sales_user_id: { type: "integer", readOnly: true, example: 1, description: "Owning sales user; set from the token" },
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
