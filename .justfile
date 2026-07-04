

# List available commands
default:
    @just --list

# Be friendly
hi:
    @echo 'hi'

# Run the Wrangler development server locally
dev:
    bunx wrangler dev

# Run the development server locally but connect to remote resources (KV, D1, R2, etc.)
dev-remote:
    bunx wrangler dev --remote

# Run the development server locally using remote resources and the production environment profile
dev-prod:
    bunx wrangler dev --remote --env production

# Deploy production
deploy:
    bun run deploy
    @date

# Stream real-time production logs (accepts optional filtering arguments)
logs *args:
    bunx wrangler tail --env production {{ args }}

# wrangler whoami
whoami:
    bunx wrangler whoami
