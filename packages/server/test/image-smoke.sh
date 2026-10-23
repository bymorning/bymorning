#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
image="bymorning-smoke:${USER:-local}"
network="bymorning-smoke-${USER:-local}-$$"
database="bymorning-smoke-postgres-$$"

docker build -f "$root/Dockerfile" -t "$image" "$root"
docker run --rm --entrypoint node "$image" --input-type=module -e '
  import { getFips } from "node:crypto"
  if (getFips() !== 1) throw new Error("FIPS mode is not active in the image")
  const host = await import("/app/bymorning.mjs")
  if (host.program === undefined) throw new Error("host program export is missing")
  if (host.migrate === undefined) throw new Error("host migrate export is missing")
  await import("@bymorning/plugin-code-interpreter-agentcore/server")
  await import("@bymorning/plugin-code-interpreter-kubernetes/server")
'

# `node bymorning.mjs migrate` must apply the embedded migrations to a fresh database and exit 0.
cleanup() {
  docker rm -f "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --rm --name "$database" --network "$network" \
  -e POSTGRES_USER=bymorning -e POSTGRES_PASSWORD=bymorning -e POSTGRES_DB=bymorning postgres:17-alpine >/dev/null
attempt=0
until docker exec "$database" pg_isready -U bymorning -d bymorning >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 60 ]; then echo "postgres did not become ready" >&2; exit 1; fi
  sleep 1
done
docker run --rm --network "$network" \
  -e DATABASE_URL="postgresql://bymorning:bymorning@$database:5432/bymorning" \
  "$image" node /app/bymorning.mjs migrate
count=$(docker exec "$database" psql -U bymorning -d bymorning -tAc 'select count(*) from drizzle.__drizzle_migrations')
expected=$(find "$root/packages/core/src/database/migration" -name migration.sql | wc -l | tr -d ' ')
if [ "$count" != "$expected" ]; then
  echo "expected $expected applied migrations, found $count" >&2
  exit 1
fi
# A second run is a no-op and still exits 0.
docker run --rm --network "$network" \
  -e DATABASE_URL="postgresql://bymorning:bymorning@$database:5432/bymorning" \
  "$image" node /app/bymorning.mjs migrate
echo "image smoke ok: $count migrations applied"
