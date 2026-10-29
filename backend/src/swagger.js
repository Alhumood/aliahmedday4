import swaggerJsdoc from "swagger-jsdoc";
import { fileURLToPath } from "node:url";
import { PERMISSION_KEYS } from "./permissions.js";

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
    description: "Needs customers.view_all, ignored otherwise. The id of a user who can own customers, or null for unassigned.",
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
        "Users without `customers.view_all` only see and change the customers assigned to them; other customers return 404.",
        "",
        "**Testing here:** call `POST /api/auth/register` (or `/login`), copy the `token` from the response,",
        "click **Authorize**, paste it, then try the Customers and Agent endpoints.",
        "",
        "**Roles and permissions:** each user has one role, and the role's permissions decide access (for example",
        "`customers.view_all`, `customers.assign`, `users.manage`). Users with `users.manage` add, edit and delete users",
        "under **Users** and manage **Roles**. The built-in Admin role has every permission except `customers.own`.",
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
          description: "The user's role lacks the permission this endpoint needs",
          content: {
            "application/json": {
              schema: { type: "object", properties: { error: { type: "string", example: "Permission required: users.manage" } } },
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
            role_id: { type: "integer", example: 2 },
            role: { type: "string", example: "Sales", description: "The role's name" },
            role_key: {
              type: "string",
              nullable: true,
              enum: ["admin", "sales", null],
              description: "Set for the built-in roles, null for custom roles",
            },
            permissions: { type: "array", items: { type: "string", enum: PERMISSION_KEYS }, example: ["customers.own", "agent.use"] },
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
            role_id: { type: "integer", example: 2, description: "Defaults to the built-in Sales role" },
          },
        },
        UserUpdate: {
          type: "object",
          description: "Only the fields sent are changed.",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password", minLength: 8, description: "Sets a new password" },
            role_id: { type: "integer", description: "You cannot change your own role" },
          },
        },
        UserDelete: {
          type: "object",
          properties: {
            reassign_to: {
              type: "integer",
              nullable: true,
              example: 2,
              description: "User (who can own customers) who receives the deleted user's customers; null or omitted leaves them unassigned",
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
        Permission: {
          type: "object",
          properties: {
            key: { type: "string", enum: PERMISSION_KEYS, example: "customers.view_all" },
            description: { type: "string" },
          },
        },
        Role: {
          type: "object",
          properties: {
            role_id: { type: "integer", example: 3 },
            name: { type: "string", example: "Sales Manager" },
            permissions: { type: "array", items: { type: "string", enum: PERMISSION_KEYS } },
            system_key: { type: "string", nullable: true, enum: ["admin", "sales", null], description: "Set for built-in roles" },
            created_at: { type: "string", format: "date-time" },
            user_count: { type: "integer", example: 3 },
          },
        },
        RoleInput: {
          type: "object",
          required: ["name", "permissions"],
          properties: {
            name: { type: "string", maxLength: 100, example: "Sales Manager" },
            permissions: {
              type: "array",
              items: { type: "string", enum: PERMISSION_KEYS },
              example: ["customers.view_all", "customers.assign", "customers.export", "agent.use"],
              description: "Needs customers.view_all or customers.own; customers.assign needs customers.view_all",
            },
          },
        },
        RoleUpdate: {
          type: "object",
          description: "Only the fields sent are changed.",
          properties: {
            name: { type: "string", maxLength: 100 },
            permissions: { type: "array", items: { type: "string", enum: PERMISSION_KEYS } },
          },
        },
        CustomerOwner: {
          type: "object",
          properties: { user_id: { type: "integer", example: 2 }, name: { type: "string", example: "Sara Sales" } },
        },
        UserWithCount: {
          allOf: [
            { $ref: "#/components/schemas/User" },
            { type: "object", properties: { customer_count: { type: "integer", example: 3 } } },
          ],
        },
        UserRoleUpdate: {
          type: "object",
          required: ["role_id"],
          properties: { role_id: { type: "integer", example: 1 } },
        },
        AssignInput: {
          type: "object",
          required: ["customer_ids", "sales_user_id"],
          properties: {
            customer_ids: { type: "array", items: { type: "integer" }, example: [1, 2, 3] },
            sales_user_id: { type: "integer", nullable: true, example: 2, description: "The id of a user who can own customers, or null to unassign" },
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
              description: "Owning user. Set from the token without customers.view_all; with it, it can be set (null = unassigned).",
            },
            sales_user_name: { type: "string", nullable: true, readOnly: true, description: "Owner's name (only with customers.view_all)" },
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
