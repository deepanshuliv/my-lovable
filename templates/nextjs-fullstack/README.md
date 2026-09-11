# Generated app

Next.js app router, TypeScript, Tailwind v4. Fullstack in a single process:

- `app/` — pages, layouts, server components
- `app/api/*/route.ts` — server endpoints
- `next.config.ts` — dev-origin allowances that keep hot reload working through the
  sandbox's TLS proxy. Changing them will break the live preview.

Secrets supplied in the builder UI arrive as environment variables. Reference them as
`process.env.DATABASE_URL` and so on — never hardcode a value, and never commit one.
