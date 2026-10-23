import { PgClient } from "@effect/sql-pg"
import { TestDatabase } from "@bymorning/testing/database"
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { Effect, Exit, Redacted, Scope } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resolveMigrationFolder, run } from "./migrator.js"

describe("PostgreSQL migrator", () => {
  const migrationsFolder = resolveMigrationFolder(undefined, process.cwd())
  const scope = Effect.runPromise(Scope.make())
  let server: TestDatabase.Interface

  const client = (database: Redacted.Redacted<string>) => PgClient.layer({ url: database, maxConnections: 1 })
  // Rows formatted as psql -At prints them: one line per row, columns joined by
  // "|", NULL empty, booleans t/f.
  const admin = (query: string, database: Redacted.Redacted<string>) =>
    Effect.runPromise(
      PgClient.PgClient.use((sql) => sql.unsafe(query).values).pipe(
        Effect.map((rows) =>
          rows
            .map((row) =>
              row
                .map((value) =>
                  value === null ? "" : typeof value === "boolean" ? (value ? "t" : "f") : String(value),
                )
                .join("|"),
            )
            .join("\n"),
        ),
        Effect.provide(client(database)),
        Effect.scoped,
      ),
    )
  /** Run a multi-statement script through the simple query protocol. */
  const execute = (script: string, database: Redacted.Redacted<string>) =>
    Effect.runPromise(
      PgClient.PgClient.use((sql) => sql.unsafe(script)).pipe(Effect.provide(client(database)), Effect.scoped),
    )

  const migrate = (database: Redacted.Redacted<string>) => Effect.runPromise(run({ url: database, migrationsFolder }))
  const history = (database: Redacted.Redacted<string>) =>
    admin("select hash || ':' || created_at from drizzle.__drizzle_migrations order by id", database)
  const expectedHistory = () => {
    const migrations = readMigrationFiles({ migrationsFolder })
    expect(migrations.map(({ folderMillis, hash, name }) => ({ folderMillis, hash, name }))).toEqual([
      {
        folderMillis: 1787989768000,
        hash: "74e44ab3dc6f597a8cc43668c9e03c794d05797d6dd80a5ce15b50a6dcbe4007",
        name: "20260829074928_baseline",
      },
      {
        folderMillis: 1787996555000,
        hash: "8235b730021db2ff876572990d3072d22d546f70415c39eb8b9af0d1204140c5",
        name: "20260829094235_remove_session_activity",
      },
      {
        folderMillis: 1788089089000,
        hash: "1b772ac23a5c700bbb8f1ef5332e85d85332d015bdab51ade05c5fdf750fb9ee",
        name: "20260830112449_add_integration_oauth_client_configuration",
      },
      {
        folderMillis: 1788099523000,
        hash: "810926c87d68dae3a4c903880427311115330a0a8dae07745cb18c602b03090c",
        name: "20260830141843_mcp-oauth",
      },
      {
        folderMillis: 1788173173000,
        hash: "520ead4cf567be9dfb7ba36adff26196aef6d7f0e4d4a486b7f228624ecd14aa",
        name: "20260831104613_usage",
      },
      {
        folderMillis: 1788214611000,
        hash: "d72cae8843629a285259c4bb2ebb1e51efb7a70a2a6d326bdbfb39681eb18344",
        name: "20260831221651_workspace-invitations",
      },
      {
        folderMillis: 1788216313000,
        hash: "2b34bc4ed9d304dfb90e48676b398cb4e7888eb44842fc67a6a4ae35e0f1d857",
        name: "20260831224513_usage-cost-completeness",
      },
      {
        folderMillis: 1788434035000,
        hash: "a8ab1819bc85428b226634accf6f80407d451092b2ecc9cafa87e729cd934a97",
        name: "20260903111355_inference",
      },
      {
        folderMillis: 1788435094000,
        hash: "c3321374115861b81c40e7803cd208db9a7c03a8d3f472cd8ece3090b37b7ae4",
        name: "20260903113134_tool-usage",
      },
      {
        folderMillis: 1788576244000,
        hash: "0d9f5711e7ad0fb1d8cd4c30c62ac3491d4fc9850efefa43a678930475968f49",
        name: "20260905024404_credential-owner",
      },
      {
        folderMillis: 1788775200000,
        hash: "10241786fe7af8d8b54d03e0e0957848a48c2cf8cca12144d2a8d47e8198cf32",
        name: "20260907100000_session-sequence",
      },
      {
        folderMillis: 1788929931000,
        hash: "fb0dea0be104d6d707f0ac4c63e8e9c83fb8a699c8c0d99446bdb923356214a3",
        name: "20260909045851_member-role",
      },
      {
        folderMillis: 1788953453000,
        hash: "4b0af9b8c72b187a44c7d5e44ba816799cb007a9d5ef647d42519b78ce2f2f93",
        name: "20260909113053_usage-principal",
      },
      {
        folderMillis: 1789129654000,
        hash: "b84655df6d3d19c58a351b55071dbed1feff8cdb04fac1b3271048bd67fd761a",
        name: "20260911122734_auth_provider",
      },
      {
        folderMillis: 1789186340000,
        hash: "279fd0ded6533a213d038d4c4663208f4cea7024eb526a94394a9a2ff1299806",
        name: "20260912041220_budget-holder",
      },
      {
        folderMillis: 1789766563000,
        hash: "00d6d92166d313df7bdd490b360fa8e2a0c01079b711f67eb23d5b6e76944230",
        name: "20260918212243_scheduled-task",
      },
      {
        folderMillis: 1789776000000,
        hash: "4b057744850ee67844577012ecf8f8e24ccf0a62f9eb81eca196fa1e585f0f1c",
        name: "20260919000000_retire-build-agent",
      },
      {
        folderMillis: 1790287712000,
        hash: "a6079a7a4d089d031d65315f9696c22f1d04c611bbe5619c11e7d9e87bed5094",
        name: "20260924220832_license",
      },
      {
        folderMillis: 1790435018000,
        hash: "9e626266e94ee6720b88fc260f8e12fac3aaa10978ae0b40388c838cb1b9ea0c",
        name: "20260926150338_installation",
      },
      {
        folderMillis: 1790438186000,
        hash: "ca8308c79f7cf997880f1df6c40e0ba1d3f5d7c9ba260748c40757ef99d717c3",
        name: "20260926155626_audit",
      },
      {
        folderMillis: 1790438713000,
        hash: "72c18082db0883b688f6a9c235b74f83c453d911b4da8ee8c86c7300066c3914",
        name: "20260926160513_data-protection",
      },
      {
        folderMillis: 1790438901000,
        hash: "59000eb13f3387f8e05c33725bfe593e85a95f90ed3dbfe0378084e9cd312abd",
        name: "20260926160821_login-session",
      },
      {
        folderMillis: 1791202237000,
        hash: "8c4f83f6162694eeae0197d34d5b1a0015caee0e7b58200ce6dee43e1c0f56f8",
        name: "20261005121037_project-archive",
      },
      {
        folderMillis: 1792385493000,
        hash: "01e224270025432478df1867406876376e84150de721c0fa0e2528f0e945f780",
        name: "20261019045133_drop-license",
      },
    ])
    return migrations.map((migration) => `${migration.hash}:${migration.folderMillis}`).join("\n")
  }
  const makeDatabase = async () => Effect.runPromise(server.create({ empty: true }).pipe(Scope.provide(await scope)))

  beforeAll(async () => {
    server = await Effect.runPromise(TestDatabase.shared)
  })

  afterAll(async () => {
    await Effect.runPromise(Scope.close(await scope, Exit.void))
  })

  it("migrates an empty PostgreSQL 17 database to the current schema and is idempotent", async () => {
    const database = await makeDatabase()
    await migrate(database)

    expect(await history(database)).toBe(expectedHistory())
    expect(await admin("select to_regclass('event'), to_regclass('event_sequence')", database)).toBe("|")
    expect(await admin("select sequence from session where false", database)).toBe("")
    expect(await admin("select count(*) from usage", database)).toBe("0")
    expect(await admin("select count(*) from tool_usage", database)).toBe("0")
    expect(
      await admin(
        `select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
         where table_schema='public' and table_name='usage'`,
        database,
      ),
    ).toBe(
      "id,workspace_id,user_id,session_id,model,input,output,reasoning,cache_read,cache_write,cost,occurred_at,cost_complete,service_account_id,source,request_id,endpoint_id,upstream_model",
    )
    expect(
      await admin(
        `select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
         where table_schema='public' and table_name='tool_usage'`,
        database,
      ),
    ).toBe("id,workspace_id,user_id,session_id,tool,status,occurred_at")
    expect(
      await admin(
        `select string_agg(indexname, ',' order by indexname) from pg_indexes
         where schemaname='public' and tablename='tool_usage' and indexname <> 'tool_usage_pkey'`,
        database,
      ),
    ).toBe(
      "tool_usage_workspace_occurred_idx,tool_usage_workspace_session_occurred_idx,tool_usage_workspace_user_occurred_idx",
    )
    expect(
      await admin(
        `select pg_get_constraintdef(oid) from pg_constraint
         where conrelid='tool_usage'::regclass and conname='tool_usage_tool_nonempty_check'`,
        database,
      ),
    ).toBe("CHECK ((length(tool) > 0))")
    expect(
      await admin(
        `select pg_get_constraintdef(oid) from pg_constraint
         where conrelid='tool_usage'::regclass and conname='tool_usage_status_check'`,
        database,
      ),
    ).toBe("CHECK ((status = ANY (ARRAY['completed'::text, 'error'::text])))")
    expect(
      await admin(
        `select pg_get_constraintdef(oid) from pg_constraint
         where conrelid='tool_usage'::regclass and conname='tool_usage_workspace_fk'`,
        database,
      ),
    ).toBe("FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE RESTRICT")
    expect(
      await admin(
        `select pg_get_constraintdef(oid) from pg_constraint
         where conrelid='tool_usage'::regclass and conname='tool_usage_user_fk'`,
        database,
      ),
    ).toBe('FOREIGN KEY (workspace_id, user_id) REFERENCES "user"(workspace_id, id) ON DELETE RESTRICT')
    expect(
      await admin(
        `select count(*) from pg_constraint c
         join lateral unnest(c.conkey) as key(attnum) on true
         join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum
         where c.conrelid='tool_usage'::regclass and c.contype='f' and a.attname='session_id'`,
        database,
      ),
    ).toBe("0")
    expect(await admin("select to_regclass('account_plugin') is null", database)).toBe("t")
    expect(
      await admin(
        `select count(*) from information_schema.tables
         where table_schema='public' and table_name in ('route','model','provider')`,
        database,
      ),
    ).toBe("0")
    expect(
      await admin(
        `select is_nullable from information_schema.columns
         where table_schema='public' and table_name='session' and column_name='user_id'`,
        database,
      ),
    ).toBe("NO")
    expect(
      await admin(
        `select pg_get_constraintdef(oid) from pg_constraint
         where conrelid='credential'::regclass and conname='credential_workspace_fk'`,
        database,
      ),
    ).toBe("FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE")
    expect(
      await admin(
        `select count(*) from information_schema.columns
         where table_schema='public' and table_name='credential' and column_name='account_id'`,
        database,
      ),
    ).toBe("0")

    const afterFirst = await history(database)
    await migrate(database)
    expect(await history(database)).toBe(afterFirst)
  })

  it("backfills Session chronology from safe legacy positions before removing Event history", async () => {
    const database = await makeDatabase()
    const latest = "20260907100000_session-sequence"
    const previousMigrations = mkdtempSync(join(tmpdir(), "bymorning-migrations-"))
    try {
      for (const entry of readdirSync(migrationsFolder)) {
        if (entry !== latest)
          cpSync(join(migrationsFolder, entry), join(previousMigrations, entry), { recursive: true })
      }
      await Effect.runPromise(run({ url: database, migrationsFolder: previousMigrations }))
      await execute(
        `
        insert into account (id, status) values ('account', 'active');
        insert into workspace (id, name, status) values ('workspace', 'Workspace', 'active');
        insert into workspace (id, name, status) values ('other', 'Other workspace', 'active');
        insert into "user" (id, workspace_id, account_id, role) values ('user', 'workspace', 'account', 'member');
        insert into project (workspace_id, id, name) values ('workspace', 'project', 'Project');
        insert into session (id, workspace_id, user_id, project_id, agent, model)
          values ('00000000-0000-0000-0000-000000000001', 'workspace', 'user', 'project', 'agent', '{}');
        insert into event_sequence (workspace_id, aggregate_id, sequence)
          values ('workspace', '00000000-0000-0000-0000-000000000001', 47);
        insert into event (id, workspace_id, aggregate_id, sequence, type, version, created_at, data)
          values
            ('00000000-0000-0000-0000-000000000002', 'workspace', '00000000-0000-0000-0000-000000000001', 29, 'session.updated', 1, now(), '{}'),
            ('00000000-0000-0000-0000-000000000003', 'workspace', '00000000-0000-0000-0000-000000000001', 9007199254740992, 'session.updated', 1, now(), '{}'),
            ('00000000-0000-0000-0000-000000000006', 'other', '00000000-0000-0000-0000-000000000001', 100, 'session.updated', 1, now(), '{}');
        insert into session_message (id, session_id, sequence, type, data)
          values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 31, 'user', '{}');
        insert into session_inbox (id, session_id, admitted_sequence, type, payload, delivery)
          values ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 43, 'user', '{}', 'queue');
        insert into session_instruction (session_id, through_sequence, initial_values, current_values)
          values ('00000000-0000-0000-0000-000000000001', 37, '{}', '{}');
      `,
        database,
      )

      await migrate(database)

      expect(await admin("select sequence from session", database)).toBe("47")
      expect(await admin("select to_regclass('event'), to_regclass('event_sequence')", database)).toBe("|")
      await expect(admin("update session set sequence = -1", database)).rejects.toThrow()
      await expect(admin("update session set sequence = 9007199254740992", database)).rejects.toThrow()
    } finally {
      rmSync(previousMigrations, { recursive: true, force: true })
    }
  })

  it("repoints Build Sessions to Default and drops the Build Agent override", async () => {
    const database = await makeDatabase()
    const latest = "20260919000000_retire-build-agent"
    const previousMigrations = mkdtempSync(join(tmpdir(), "bymorning-migrations-"))
    try {
      for (const entry of readdirSync(migrationsFolder)) {
        if (entry !== latest)
          cpSync(join(migrationsFolder, entry), join(previousMigrations, entry), { recursive: true })
      }
      await Effect.runPromise(run({ url: database, migrationsFolder: previousMigrations }))
      await execute(
        `
        insert into account (id, status) values ('account', 'active');
        insert into workspace (id, name, status) values ('workspace', 'Workspace', 'active');
        insert into "user" (id, workspace_id, account_id, role) values ('user', 'workspace', 'account', 'member');
        insert into project (workspace_id, id, name) values ('workspace', 'project', 'Project');
        insert into session (id, workspace_id, user_id, project_id, agent, model)
          values ('00000000-0000-0000-0000-000000000001', 'workspace', 'user', 'project', 'build', '{}');
        insert into session (id, workspace_id, user_id, project_id, agent, model)
          values ('00000000-0000-0000-0000-000000000002', 'workspace', 'user', 'project', 'default', '{}');
        insert into agent (workspace_id, id, name, instructions, mode, hidden, permissions)
          values ('workspace', 'build', 'Build', 'a workspace override of the retired built-in', 'primary', false, '[]');
        insert into agent (workspace_id, id, name, instructions, mode, hidden, permissions)
          values ('workspace', 'default', 'Default', 'a workspace override that must survive', 'primary', false, '[]');
      `,
        database,
      )

      await migrate(database)

      expect(
        await admin(
          "select agent from session where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002') order by id",
          database,
        ),
      ).toBe("default\ndefault")
      expect(await admin("select id from agent where workspace_id = 'workspace' order by id", database)).toBe("default")
      expect(await admin("select instructions from agent where id = 'default'", database)).toBe(
        "a workspace override that must survive",
      )
    } finally {
      rmSync(previousMigrations, { recursive: true, force: true })
    }
  })

  it("preserves unrelated public-schema objects while applying every migration", async () => {
    const database = await makeDatabase()
    await execute(
      "create table legacy_unrelated (id text primary key); insert into legacy_unrelated values ('preserved')",
      database,
    )

    await migrate(database)

    expect(await admin("select id from legacy_unrelated", database)).toBe("preserved")
    expect(await history(database)).toBe(expectedHistory())
    expect(
      await admin(
        `select count(*) from information_schema.columns
         where table_schema='public' and table_name='session' and column_name='activity'`,
        database,
      ),
    ).toBe("0")
    expect(
      await admin(
        `select count(*) from pg_constraint
         where conrelid='session'::regclass and conname='session_activity_check'`,
        database,
      ),
    ).toBe("0")
  })

  it("serializes concurrent migrators with one ordered migration history", async () => {
    const database = await makeDatabase()
    await Effect.runPromise(
      Effect.all([run({ url: database, migrationsFolder }), run({ url: database, migrationsFolder })], {
        concurrency: "unbounded",
        discard: true,
      }),
    )
    expect(await history(database)).toBe(expectedHistory())
  })
})
