#!/usr/bin/env bash
set -euo pipefail
echo "Setting up nexus-ai"
echo "Creating D1 database..."
npx wrangler d1 create nemotron-nexus-db
echo "Creating R2 bucket..."
npx wrangler r2 bucket create nemotron-nexus-bucket
echo "Creating KV namespaces..."
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create SESSIONS
echo "Creating Vectorize index..."
npx wrangler vectorize create nemotron-nexus-index --dimensions=1024 --metric=cosine
echo "Creating Queue..."
npx wrangler queues create nemotron-nexus-docs
echo "Initializing D1 schema..."
npx wrangler d1 execute nemotron-nexus-db --file=./schema.sql --remote
echo "Done. Copy the printed IDs into wrangler.jsonc (replace REPLACE_WITH_...), then: npm install && npm run deploy"
echo "Deploy will fail until those placeholders are real Cloudflare IDs."
