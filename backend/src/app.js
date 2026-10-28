import "dotenv/config";
import express from "express";
import cors from "cors";
import { swaggerSpec } from "./swagger.js";
import { pool } from "./db.js";
import customerRoutes from "./routes/customers.js";
import agentRoutes from "./routes/agent.js";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(",") ?? "*" }));
app.use(express.json());

// Swagger UI assets come from a CDN so the page also works on Vercel,
// where swagger-ui-express can't serve its static files from node_modules.
const SWAGGER_UI_CDN = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.0";
const swaggerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Customer API - Swagger UI</title>
  <link rel="stylesheet" href="${SWAGGER_UI_CDN}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI_CDN}/swagger-ui-bundle.js"></script>
  <script src="${SWAGGER_UI_CDN}/swagger-ui-standalone-preset.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/swagger.json",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
    });
  </script>
</body>
</html>`;

app.get(["/swagger", "/swagger/"], (_req, res) => res.type("html").send(swaggerHtml));
app.get("/swagger.json", (_req, res) => res.json(swaggerSpec));
app.get("/", (_req, res) => res.redirect("/swagger"));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected", agent: Boolean(process.env.ANTHROPIC_API_KEY) });
  } catch (err) {
    res.status(503).json({ status: "error", database: err.message });
  }
});

app.use("/api/customers", customerRoutes);
app.use("/api/agent", agentRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

export default app;
