import swaggerJsdoc from "swagger-jsdoc";
import { fileURLToPath } from "node:url";

const customerProps = {
  name: { type: "string", example: "Jane Doe" },
  email: { type: "string", nullable: true, example: "jane@example.com" },
  phone: { type: "string", nullable: true, example: "0501234567" },
};

const adminOwnerProp = {
  sales_user_id: {
    type: "integer",
    nullable: true,
    example: 2,
    description: "Admin only, ignored for sales users. A sales user's id, or null for unassigned.",
  },
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
        "",
        "**Admins** see every customer (with `sales_user_name`), can assign customers to sales users and manage roles",
        "under **Users**, including adding, editing and deleting users. Admins also manage **Job Titles** (labels only, not permissions).",
        "Make the first admin locally with `npm run make-admin -- <email>` after registering, then log in again.",
      ].join("\n"),
    },
    servers: [{ url: "/", description: "Current host" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      responses: {
        Forbidden: {
          description: "Admin access required",
          content: {
            "application/json": {
              schema: { type: "object", properties: { error: { type: "string", example: "Admin access required" } } },
            },
          },
        },
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
            role: { type: "string", enum: ["sales", "admin"], example: "sales" },
            job_title_id: { type: "integer", nullable: true, example: 1 },
            job_title: { type: "string", nullable: true, example: "Account Manager", description: "A label only; access depends on role" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        UserCreate: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            name: { type: "string", example: "Omar Sales" },
            email: { type: "string", format: "email", example: "omar@example.com" },
            password: { type: "string", format: "password", minLength: 8, example: "password123" },
            role: { type: "string", enum: ["sales", "admin"], default: "sales" },
            job_title_id: { type: "integer", nullable: true, example: 1 },
          },
        },
        UserUpdate: {
          type: "object",
          description: "Only the fields sent are changed.",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password", minLength: 8, description: "Sets a new password" },
            role: { type: "string", enum: ["sales", "admin"] },
            job_title_id: { type: "integer", nullable: true, description: "null clears the job title" },
          },
        },
        UserDelete: {
          type: "object",
          properties: {
            reassign_to: {
              type: "integer",
              nullable: true,
              example: 2,
              description: "Sales user who receives the deleted user's customers; null or omitted leaves them unassigned",
            },
          },
        },
        UserDeleteResult: {
          type: "object",
          properties: {
            deleted_user: {
              type: "object",
              properties: { user_id: { type: "integer" }, name: { type: "string" }, email: { type: "string" }, role: { type: "string" } },
            },
            customers_moved: { type: "integer", example: 3 },
            reassigned_to: { type: "integer", nullable: true, example: 2 },
          },
        },
        JobTitle: {
          type: "object",
          properties: {
            job_title_id: { type: "integer", example: 1 },
            name: { type: "string", example: "Account Manager" },
            created_at: { type: "string", format: "date-time" },
            user_count: { type: "integer", example: 3 },
          },
        },
        JobTitleInput: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", maxLength: 100, example: "Account Manager" } },
        },
        UserWithCount: {
          allOf: [
            { $ref: "#/components/schemas/User" },
            { type: "object", properties: { customer_count: { type: "integer", example: 3 } } },
          ],
        },
        RoleUpdate: {
          type: "object",
          required: ["role"],
          properties: { role: { type: "string", enum: ["sales", "admin"], example: "admin" } },
        },
        AssignInput: {
          type: "object",
          required: ["customer_ids", "sales_user_id"],
          properties: {
            customer_ids: { type: "array", items: { type: "integer" }, example: [1, 2, 3] },
            sales_user_id: { type: "integer", nullable: true, example: 2, description: "A sales user's id, or null to unassign" },
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
            sales_user_id: {
              type: "integer",
              nullable: true,
              example: 1,
              description: "Owning sales user. Set from the token for sales users; admins can set it (null = unassigned).",
            },
            sales_user_name: { type: "string", nullable: true, readOnly: true, description: "Owner's name (admin responses only)" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        CustomerInput: { type: "object", required: ["name"], properties: customerProps },
        CustomerUpdate: { type: "object", properties: customerProps },
        AdminCustomerInput: {
          type: "object",
          required: ["name"],
          properties: { ...customerProps, ...adminOwnerProp },
        },
        AdminCustomerUpdate: { type: "object", properties: { ...customerProps, ...adminOwnerProp } },
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
