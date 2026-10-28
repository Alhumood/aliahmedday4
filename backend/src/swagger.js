import swaggerJsdoc from "swagger-jsdoc";
import { fileURLToPath } from "node:url";

const customerProps = {
  name: { type: "string", example: "Jane Doe" },
  email: { type: "string", nullable: true, example: "jane@example.com" },
  phone: { type: "string", nullable: true, example: "0501234567" },
};

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Customer API",
      version: "1.0.0",
      description: "CRUD REST API for the customer table, plus a Claude-powered natural-language agent endpoint.",
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
      },
    },
  },
  apis: [fileURLToPath(new URL("./routes/*.js", import.meta.url))],
});
