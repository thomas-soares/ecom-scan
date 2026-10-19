# Ecom Scan

Ecom Scan is a full-stack ecommerce diagnostics platform that analyzes online stores and turns technical observations into an actionable report.

The application evaluates storefront technology, tracking implementation, conversion events, performance signals, external scripts, advertising activity, and potential commercial impact from a single scan.

## What it does

Ecom Scan combines browser automation, network inspection, ecommerce heuristics, and structured reporting to help teams understand how an online store is performing from a technical and measurement perspective.

The main workflow is:

1. A user submits an ecommerce store URL.
2. The API validates and creates a scan.
3. The scan is queued in Redis through BullMQ.
4. A dedicated Playwright worker navigates through the store.
5. The worker observes page behavior, network requests, storefront signals, and conversion interactions.
6. Results are persisted in PostgreSQL through Prisma.
7. The web application presents the completed diagnostic report.

## Key capabilities

- Detect ecommerce platforms such as Shopify, Nuvemshop, VTEX, and Tray.
- Inspect marketing and analytics signals from observed browser activity.
- Validate page view, add-to-cart, and initiate-checkout event flows.
- Validate request payload quality and identify missing event information.
- Detect advertising signals through public Meta Ads Library and Google Ads Transparency pages.
- Measure navigation timing, request volume, script transfer size, and image transfer size.
- Identify external applications and scripts loaded by a storefront.
- Audit image optimization signals such as oversized images, lazy loading, and legacy formats.
- Retrieve public domain information such as expiration data when available.
- Estimate potential monthly impact from diagnostic findings and user-provided assumptions.
- Persist scan history and allow users to revisit completed reports.
- Reuse recent compatible scans to avoid unnecessary repeated work.
- Process long-running scans asynchronously with retries and exponential backoff.

## Architecture

~~~text
┌─────────────────────┐
│  Next.js Web App    │
│  React + Tailwind   │
└──────────┬──────────┘
           │ authenticated server-side proxy
           ▼
┌─────────────────────┐
│  NestJS API         │
│  validation + auth  │
└──────┬────────┬─────┘
       │        │
       │        ▼
       │  ┌───────────────┐
       │  │ PostgreSQL    │
       │  │ Prisma ORM    │
       │  └───────────────┘
       │
       ▼
┌─────────────────────┐
│  Redis + BullMQ     │
│  scan job queue     │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  Scan Worker        │
│  Playwright         │
│  browser analysis   │
└─────────────────────┘
~~~

### Web application

The Next.js application provides the authenticated user experience, scan creation flow, progress states, history, diagnostics, and report presentation.

### API

The NestJS API is responsible for request validation, user-scoped scan operations, platform inference, persistence orchestration, and queue publishing.

### Scan worker

The worker consumes scan jobs from BullMQ and uses Playwright to load storefronts, inspect resources and requests, interact with product and checkout flows, collect evidence, and generate structured diagnostic data.

### Persistence

PostgreSQL stores users, sessions, stores, scans, platform detections, event validations, findings, and reports. Prisma provides the data model and type-safe database client.

## Technology stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- NestJS
- Better Auth
- PostgreSQL
- Prisma
- Redis
- BullMQ
- Playwright
- Docker Compose
- pnpm workspaces

## Project structure

~~~text
.
├── apps
│   ├── api
│   │   └── src
│   │       ├── common
│   │       └── modules
│   └── scan-worker
│       └── src
│           └── scan
├── prisma
│   └── schema.prisma
├── public
├── src
│   ├── app
│   ├── components
│   └── lib
├── docker-compose.yml
├── Dockerfile.worker
├── package.json
└── pnpm-workspace.yaml
~~~

## Requirements

- Node.js 22 or newer
- pnpm
- Docker Desktop, when using the containerized development stack
- A PostgreSQL database
- A Redis instance
- Playwright browser dependencies for the scan worker

## Getting started

### 1. Install dependencies

~~~bash
pnpm install
~~~

### 2. Configure environment variables

Copy the example file:

~~~bash
cp .env.example .env
~~~

On Windows PowerShell:

~~~powershell
Copy-Item .env.example .env
~~~

Review the values in .env before starting the application.

### 3. Generate the Prisma client

~~~bash
pnpm prisma:generate
~~~

### 4. Start the local infrastructure

~~~bash
pnpm dev:stack
~~~

This starts PostgreSQL, Redis, the API, and the scan worker through Docker Compose.

### 5. Start the web application

In a separate terminal:

~~~bash
pnpm dev:web
~~~

The web application is available at:

~~~text
http://localhost:3000
~~~

The API runs on:

~~~text
http://localhost:4000
~~~

## Running services individually

The services can also be started separately:

~~~bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
~~~

When running services individually, PostgreSQL and Redis must already be available and the corresponding connection variables must be configured in .env.

## Environment variables

The complete development configuration is documented in .env.example.

Important variables include:

- NEXT_PUBLIC_APP_URL: public URL of the web application.
- NEXT_PUBLIC_API_URL: API URL used by the web application.
- API_INTERNAL_URL: server-side API URL used by Next.js route handlers.
- WEB_ORIGIN: allowed web origin for API CORS.
- BETTER_AUTH_URL: base URL used by Better Auth.
- BETTER_AUTH_SECRET: secret used to protect authentication sessions.
- BETTER_AUTH_TRUSTED_ORIGINS: comma-separated list of trusted origins.
- DATABASE_URL: PostgreSQL connection string.
- REDIS_URL: Redis connection string.
- API_PORT: API listening port.
- SCAN_WORKER_CONCURRENCY: number of scans processed concurrently by the worker.
- ENABLE_RECENT_SCAN_REUSE: enables reuse of compatible recent scans.
- RECENT_SCAN_REUSE_WINDOW_MINUTES: recent scan reuse window.
- META_AD_LIBRARY_ACCESS_TOKEN: optional Meta Ads Library configuration.
- META_AD_LIBRARY_COUNTRIES: countries used by advertising queries.
- META_AD_LIBRARY_MAX_COUNT: maximum advertising results to collect.
- GOOGLE_AD_TRANSPARENCY_REGION: region used for Google advertising queries.

Never commit .env or production credentials.

## Available commands

~~~bash
pnpm dev:web              # Start the Next.js web application
pnpm dev:api              # Start the NestJS API
pnpm dev:worker           # Start the scan worker
pnpm dev:stack            # Start the Docker Compose development stack
pnpm dev:stack:logs       # Follow API and worker logs
pnpm dev:stack:down       # Stop the development stack
pnpm dev:stack:reset      # Stop the stack and remove local volumes
pnpm lint                 # Run ESLint
pnpm build                # Build the web application
pnpm build:api            # Build the API
pnpm build:worker         # Build the worker
pnpm prisma:generate      # Generate the Prisma client
pnpm prisma:migrate       # Run Prisma development migrations
pnpm prisma:studio        # Open Prisma Studio
~~~

## Scan report model

Each completed scan produces a structured report containing:

- storefront platform detection;
- tracking and advertising platform detections;
- observed network evidence;
- conversion event validation;
- performance metrics;
- image audit results;
- external application summaries;
- public domain information;
- prioritized findings;
- estimated monthly impact;
- diagnostic summary and confidence signals.

The report is designed to present a high-level business summary first and preserve technical evidence for deeper analysis.

## Design principles

- **Evidence over assumptions:** findings are based on observed browser behavior, requests, page content, and measurable signals.
- **Asynchronous by design:** browser scans run outside the request lifecycle so the API remains responsive.
- **User-scoped history:** scans and reports are associated with the requesting user.
- **Progressive detail:** reports expose an executive summary first and technical evidence as supporting detail.
- **Operational resilience:** scan jobs use retries and exponential backoff for transient failures.
- **Platform-aware analysis:** detection and interaction strategies adapt to the identified ecommerce platform.

## Future roadmap

The following ideas describe possible future directions:

- Add a prebuilt public report demo.
- Add automated unit, integration, and end-to-end test coverage.
- Add scan comparison and historical score evolution.
- Add secure report sharing with expiring access tokens.
- Add PDF report export.
- Add structured observability and scan metrics.
- Add more ecommerce platforms and advertising sources.
- Improve platform-specific recommendations.
- Add team workspaces and organization-level permissions.

## License

This project is distributed under the [Ecom Scan Proprietary License](./LICENSE.md).
See the license for permitted and restricted uses.
