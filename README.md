# EZ Appliances

Washer & dryer rental site: static frontend, Express API, Postgres, Stripe billing.

## Project structure

```
ezappliances/
├── public/              # Static frontend, served as-is by Express
│   ├── index.html
│   ├── pay-bill.html
│   ├── css/styles.css
│   └── js/main.js
├── src/
│   ├── app.js            # Express app: mounts static files + all routes
│   ├── db/
│   │   └── pool.js       # Shared Postgres connection pool
│   ├── lib/
│   │   └── adminAuth.js  # PBKDF2 hashing and token helpers
│   ├── middleware/
│   │   └── requireAdmin.js
│   └── routes/
│       ├── webhook.js    # Stripe webhook (subscriptions/invoices)
│       ├── orders.js     # POST /api/orders — booking form
│       ├── account.js    # POST /api/account/lookup — pay-bill form
│       └── admin.js      # Admin login + protected admin routes
├── db/
│   └── schema.sql        # Postgres schema (auto-run by docker-compose)
├── server.js              # Entry point — loads .env, starts the app
├── docker-compose.yml
├── .env.example
└── package.json
```

## Setup

```bash
npm install
cp .env.example .env   # then fill in real values
docker compose up --build
```

Or without Docker, once Postgres is running elsewhere:

```bash
npm install
cp .env.example .env   # then fill in real values, pointing DATABASE_URL at your DB
npm start
```

Visit `http://localhost:3000` for the homepage, `/pay-bill.html` for account lookup.

## Rotate before deploying

The Stripe key and Postgres password previously lived hardcoded in this repo's
Docker config. If that ever got pushed, treat those values as compromised:
rotate the Stripe secret key and webhook secret in the Stripe dashboard, and
change the Postgres password.
