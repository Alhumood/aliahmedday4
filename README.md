# Customer Hub

Two projects:

| Project    | Stack                                              | Port |
|------------|----------------------------------------------------|------|
| `backend`  | Node.js, Express, PostgreSQL (`pg`), Swagger, Anthropic SDK | 4000 |
| `frontend` | React + Vite                                       | 5173 |

## Backend

```bash
cd backend
npm install
# put your Anthropic key in backend/.env -> ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

- Swagger UI: http://localhost:4000/swagger
- Health: `GET /api/health`
- CRUD: `GET/POST /api/customers`, `GET/PUT/DELETE /api/customers/{id}`, `GET /api/customers?name=kan`
- Agent: `POST /api/agent/chat` with `{ "message": "get all customers" }`.
  Send the returned `conversationId` back to continue the conversation.

The agent uses Claude (`claude-opus-5-5`) with these tools: `get_all_customers`,
`get_customer_by_name`, `get_customer_by_id`, `add_customer`, `update_customer`.
The agent cannot delete. Deleting only works through the REST API and the UI.
CORS allows `FRONTEND_ORIGIN` (default `http://localhost:5173`).

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The **Customers** page has search, add, edit and delete. The **AI Assistant** page is the chat.
The backend URL is set by `VITE_API_URL` in `frontend/.env`.
