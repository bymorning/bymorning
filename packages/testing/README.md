# Testing the real Application

Run backend and SDK scenarios from this package with `bun run test`. The fixture creates a real Application,
disposable PostgreSQL database, generated SDK client, real local authentication, and scripted model endpoint.
Reuse `src/scenario` from backend and browser tests; synchronize through model gates and events, never sleeps.
Browser scenarios run from `packages/web` with `bun run test:application`.
