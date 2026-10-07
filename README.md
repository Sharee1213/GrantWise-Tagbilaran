# GrantWise-Tagbilaran
GrantWise Tagbilaran – Barangay-Linked College Scholarship Grant Disbursement System

## Backend database setup
- Ensure the Neon PostgreSQL connection string is configured in Backend/.env as DATABASE_URL.
- Run `cd Backend && npm install` if dependencies are not already installed.
- Initialize the schema with `npm run init-db`.
- Start the API with `npm run dev` or `npm start`.
- Use the `POST /api/init-db` endpoint to run the schema from the server when needed.

