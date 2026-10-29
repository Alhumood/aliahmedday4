import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { chat, resetConversation } from "../agent.js";

const router = Router();

/**
 * @openapi
 * /api/agent/chat:
 *   post:
 *     tags: [Agent]
 *     summary: Ask a natural-language question about customer data
 *     description: |
 *       Claude answers using tools that read and write the customer table,
 *       limited to the customers assigned to the logged-in user.
 *       Try: "get all customers", "find customer Kannan",
 *       "add customer Sara with email sara@example.com".
 *       Pass the returned conversationId to continue the same conversation.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, example: "Get all customers" }
 *               conversationId: { type: string, description: "Optional, from a previous response" }
 *     responses:
 *       200:
 *         description: Agent reply
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversationId: { type: string }
 *                 reply: { type: string }
 *                 toolCalls:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name: { type: string }
 *                       input: { type: object }
 *       400: { description: message is required }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       503: { description: Anthropic API key not configured }
 */
router.post("/chat", async (req, res, next) => {
  const { message, conversationId } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    res.json(await chat(req.user, message.trim(), conversationId));
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Anthropic API error: ${err.message}` });
    }
    next(err);
  }
});

/**
 * @openapi
 * /api/agent/chat/{conversationId}:
 *   delete:
 *     tags: [Agent]
 *     summary: Forget a conversation's history
 *     parameters:
 *       - { in: path, name: conversationId, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Conversation cleared }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.delete("/chat/:conversationId", (req, res) => {
  resetConversation(req.user.user_id, req.params.conversationId);
  res.status(204).end();
});

export default router;
