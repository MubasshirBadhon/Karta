# Karta

**Turn every conversation into a sale.**

Karta is an AI commerce platform for WooCommerce merchants. It connects to a merchant's WooCommerce store, synchronizes products, and uses AI to answer customer questions on the website and WhatsApp — all powered by real product data.

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Styling:** Tailwind CSS
- **AI Provider:** Groq
- **Package Manager:** pnpm

## Project Structure

```
karta/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   └── health/        # Health check endpoint
│   ├── dashboard/         # Merchant dashboard
│   ├── demo/              # AI demo page
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Landing page
├── components/            # React components
├── lib/                   # Core libraries
│   ├── db/               # Database client (Prisma)
│   ├── ai/               # AI provider abstraction
│   ├── commerce/         # Commerce service layer
│   ├── channels/         # Channel abstraction (UnifiedMessage)
│   └── security/         # Security utilities
├── prisma/               # Prisma schema and migrations
│   └── schema.prisma
├── docs/                 # Documentation
│   ├── security.md
│   ├── ai-commerce-rules.md
│   └── investor-demo.md
├── public/               # Static assets
├── .env.example          # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- pnpm

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL and API keys

# Generate Prisma client
pnpm db:generate

# Push database schema
pnpm db:push

# Start development server
pnpm dev
```

The app will be available at `http://localhost:3000`.

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `GROQ_API_KEY` | Groq API key for AI | Yes |
| `APP_URL` | Application URL | Yes |
| `WORDPRESS_CONNECT_SECRET` | Secret for WordPress plugin connection | Phase 2 |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Business API token | Phase 2 |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp webhook verification token | Phase 2 |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID | Phase 2 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp business account ID | Phase 2 |

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run tests |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:push` | Push schema to database |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:studio` | Open Prisma Studio |

## Architecture

### Commerce Engine Boundary

The AI never directly queries the database. All commerce operations go through the service layer:

```
AI → Commerce Tool → Commerce Service → Prisma → PostgreSQL
```

### AI Provider Abstraction

The AI engine uses a provider interface, not a specific implementation:

```
AI Engine → AIProvider interface → GroqProvider → Groq API
```

### Channel Abstraction

Messages from any channel are normalized to a unified format:

```
Website message → UnifiedMessage → AI Engine
WhatsApp message → UnifiedMessage → AI Engine
```

### Multi-Tenancy

Every entity belongs to a tenant. All commerce queries are tenant-scoped:

```
Tenant → Products, Customers, Conversations, Orders
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |

## License

Private — All rights reserved.
