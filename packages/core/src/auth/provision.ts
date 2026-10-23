import { Account } from "@bymorning/schema/account"
import { Auth } from "@bymorning/schema/auth"
import { Project } from "@bymorning/schema/project"
import { User } from "@bymorning/schema/user"
import { Workspace } from "@bymorning/schema/workspace"
import { Effect, Schema, Stream } from "effect"
import type { Database } from "../database.js"
import { AccountTable } from "../database/schema/account.sql.js"
import { AuthTable } from "../database/schema/auth.sql.js"
import { ConfigTable } from "../database/schema/config.sql.js"
import { ProjectTable } from "../database/schema/project.sql.js"
import { UserTable } from "../database/schema/user.sql.js"
import { WorkspaceTable } from "../database/schema/workspace.sql.js"
import type { Storage } from "../storage.js"

/** First-Workspace provisioning failed without exposing persistence details. */
export class ProvisionError extends Schema.TaggedError<ProvisionError>()("Auth.ProvisionError", {}) {}

interface Input {
  readonly provider: Auth.Provider
  readonly subject: Auth.Sub
  readonly emailProvider: Auth.Provider
  readonly emailSubject: Auth.Sub
}

/** Provision a first Account and its verified identity links inside Auth's active transaction. */
export const provision = Effect.fn("Auth.provision")(
  function* (database: Database.Interface, input: Input) {
    const account = { id: Account.ID.create(), status: "active" } satisfies Account.Info
    yield* database.use("Auth.provision", (db) =>
      Effect.gen(function* () {
        yield* db.insert(AccountTable).values(account)
        yield* db.insert(AuthTable).values([
          {
            id: Auth.ID.create(),
            provider: input.provider,
            subject: input.subject,
            accountId: account.id,
          },
          {
            id: Auth.ID.create(),
            provider: input.emailProvider,
            subject: input.emailSubject,
            accountId: account.id,
          },
        ])
      }),
    )
    return account
  },
  Effect.mapError(() => new ProvisionError({})),
)

/** Provision BM's default Workspace resources for a newly created Account. */
export const provisionWorkspace = Effect.fn("Auth.provisionWorkspace")(
  function* (database: Database.Interface, storage: Storage.Interface, accountID: Account.ID) {
    const workspace = { id: Workspace.ID.create(), name: "Default", status: "active" } satisfies Workspace.Info
    const project = { id: Project.ID.create(), workspaceID: workspace.id, name: "Default" }
    yield* database.use("Auth.provisionWorkspace", (db) =>
      Effect.gen(function* () {
        yield* db.insert(WorkspaceTable).values(workspace)
        yield* db.insert(ConfigTable).values({ workspaceId: workspace.id })
        yield* db.insert(ProjectTable).values(project)
        yield* db.insert(UserTable).values({
          id: User.ID.create(),
          accountId: accountID,
          email: null,
          workspaceId: workspace.id,
          role: "admin",
        })
      }),
    )
    yield* database.afterCommit(
      storage.object
        .set([{ workspaces: workspace.id }, { projects: project.id }], {
          body: Stream.empty,
          contentLength: 0,
        })
        .pipe(Effect.orDie, Effect.asVoid),
    )
  },
  Effect.mapError(() => new ProvisionError({})),
)
