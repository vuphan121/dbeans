# dbeans

A lightweight, self-hosted, web-based database management tool for personal use — in the spirit of DBeaver, but simpler in scope and deliberately obsessed with clean UI/UX.

dbeans lets you connect to your databases from a browser, browse schemas, write and run SQL, and view/edit results — without installing a desktop app, and without the visual clutter of traditional DB clients.

## Status

Early planning stage. No code yet — see the docs below for the current plan.

## Docs

- [Product Requirements](docs/PRD.md) — vision, goals, non-goals, feature scope, phased roadmap
- [Architecture](docs/ARCHITECTURE.md) — tech stack, system design, security, deployment
- [Design](docs/DESIGN.md) — UI/UX principles, visual style, key screens and interactions

## At a glance

- **Backend:** Go, single binary, embeds the frontend build
- **Frontend:** React + TypeScript
- **Databases supported (v1):** PostgreSQL, MySQL/MariaDB, SQLite
- **Auth:** single-user password/passphrase gate (this is a personal tool, not multi-tenant)
- **Deployment:** single Docker container, self-hosted
