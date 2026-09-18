# dbeans

A lightweight, self-hosted, web-based database management tool for personal use — in the spirit of DBeaver, but simpler in scope and deliberately obsessed with clean UI/UX.

dbeans lets you connect to your databases from a browser, browse schemas, directly browse/filter/edit table data, write and run SQL, and view/edit results — without installing a desktop app, and without the visual clutter of traditional DB clients.

## Status

Working app: real accounts, connections, schema browsing + SQL execution, a paginated table data editor (Postgres), and typed scheduled jobs (queries and HTTP requests) — see the docs below for exact scope and what's still stubbed/planned.

## Docs

- [Product Requirements](docs/PRD.md) — vision, goals, non-goals, feature scope, phased roadmap
- [Architecture](docs/ARCHITECTURE.md) — tech stack, system design, security, deployment
- [Design](docs/DESIGN.md) — UI/UX principles, visual style, key screens and interactions
- [Deployment](docs/DEPLOYMENT.md) — step-by-step Vercel setup (two projects: frontend + backend)
- [Data Editor Testing](docs/DATA_EDITOR_TESTING.md) — safe disposable fixture, automated checks, browser/API acceptance matrix, and cleanup guidance for agents

## At a glance

- **Backend:** Go — runs either as a plain binary (local dev, any traditional host) or as a Vercel Go serverless function, same code either way
- **Frontend:** React + TypeScript (Vite)
- **Sources supported:** PostgreSQL (schema browsing, query execution, and table-data CRUD), Redis (key browsing and CRUD), and Kafka (topic/message browsing + producing) are live; MySQL/MariaDB and SQLite connections can be saved but don't execute yet
- **Auth:** real username/password accounts (bcrypt + Postgres), seeded server-side — this is a personal tool, not multi-tenant
- **Deployment:** two Vercel projects (frontend + backend), or the backend on any traditional host (Railway/Fly.io/a VPS) with just the frontend on Vercel — see [Deployment](docs/DEPLOYMENT.md)
