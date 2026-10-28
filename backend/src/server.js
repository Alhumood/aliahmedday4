import "dotenv/config";
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger.js";
import { pool } from "./db.js";
import customerRoutes from "./routes/customers.js";
import agentRoutes from "./routes/agent.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(",") ?? "*" }));
app.use(express.json());

app.use("/swagger", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/swagger.json", (_req, res) => res.json(swaggerSpec));

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

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  console.log(`Swagger UI:    http://localhost:${PORT}/swagger`);
});
