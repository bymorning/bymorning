import { User } from "@bymorning/core/user"
import { Auth } from "@bymorning/schema/auth"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"

test("[SEC-INVITE-04] invitation admission uses the authenticated membership's current admin role", async ({
  signal,
}) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const input = { email: Auth.Email.make("member@bymorning.ai"), role: "member" as const }
      const anonymous = yield* Effect.tryPromise(() => app.client.user.invite(input)).pipe(Effect.flip)
      expect(anonymous.cause).toMatchObject({ _tag: "UnauthorizedError" })

      const admin = yield* app.login()
      expect(admin.properties.role).toBe("admin")
      const invited = yield* Effect.tryPromise(() => app.client.user.invite(input))
      expect(invited).toMatchObject({ ...input, status: "pending" })
      const memberClient = app.clientFor()
      const member = yield* app.login(memberClient, {
        subject: Auth.Sub.make("test-member"),
        email: input.email,
      })
      expect(member.properties.role).toBe("member")
      expect(member.properties.workspaceID).toBe(admin.properties.workspaceID)

      const forbidden = { email: Auth.Email.make("denied@bymorning.ai"), role: "admin" as const }
      const denied = yield* Effect.tryPromise(() => memberClient.user.invite(forbidden)).pipe(Effect.flip)
      expect(denied.cause).toMatchObject({ _tag: "ForbiddenError" })
      expect((yield* Effect.tryPromise(() => app.client.user.list())).members).toHaveLength(2)

      const promoted = yield* Effect.tryPromise(() => app.client.user.invite({ ...input, role: "admin" }))
      expect(promoted).toMatchObject({ email: input.email, role: "admin", status: "active" })
      // The same cookie observes a changed membership role without logging in again.
      yield* Effect.tryPromise(() => memberClient.user.invite({ ...forbidden, role: "member" }))
      yield* Effect.tryPromise(() => app.client.user.invite(input))
      const demoted = yield* Effect.tryPromise(() => memberClient.user.invite(forbidden)).pipe(Effect.flip)
      expect(demoted.cause).toMatchObject({ _tag: "ForbiddenError" })
      expect(
        (yield* Effect.tryPromise(() => app.client.user.list())).members.find(
          (entry) => entry.email === forbidden.email,
        ),
      ).toMatchObject({ role: "member", status: "pending" })

      const other = yield* TestApp.make()
      const outsider = yield* other.login()
      const foreign = yield* Effect.tryPromise(() =>
        app.client.user.invite({
          ...forbidden,
          workspace: outsider.properties.workspaceID,
        }),
      ).pipe(Effect.flip)
      expect(foreign.cause).toMatchObject({ _tag: "UnauthorizedError" })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("[SEC-INVITE-05] invitation email admission is outside the Core input and operation", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const admin = yield* app.login()
      const input = { email: Auth.Email.make("external@example.com"), role: "member" as const }
      const denied = yield* Effect.tryPromise(() => app.client.user.invite(input)).pipe(Effect.flip)
      expect(denied.cause).toMatchObject({ _tag: "ForbiddenError" })
      expect((yield* Effect.tryPromise(() => app.client.user.list())).members).toHaveLength(1)

      const invited = yield* app.process(User.Service.use((users) => users.invite(admin.properties.workspaceID, input)))
      expect(invited).toMatchObject({ ...input, status: "pending" })
      expect((yield* Effect.tryPromise(() => app.client.user.list())).members).toContainEqual(invited)
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("reinviting the sole admin as a member is refused, names them, and keeps the Role", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const admin = yield* app.login()
      const self = (yield* Effect.tryPromise(() => app.client.user.list())).members.find(
        (entry) => entry.id === admin.properties.userID,
      )
      expect(self).toBeDefined()
      const email = Auth.Email.make(self!.email)
      const refused = yield* Effect.tryPromise(() => app.client.user.invite({ email, role: "member" })).pipe(
        Effect.flip,
      )
      expect(refused.cause).toMatchObject({
        _tag: "ForbiddenError",
        message: `${email} is already the Workspace's only admin; an invitation cannot change their role.`,
      })
      const members = (yield* Effect.tryPromise(() => app.client.user.list())).members
      expect(members.filter((member) => member.role === "admin")).toHaveLength(1)
      expect(members.find((entry) => entry.email === email)).toMatchObject({ role: "admin" })
      // Still an administrator: the admin-only invitation endpoint stays reachable.
      yield* Effect.tryPromise(() =>
        app.client.user.invite({ email: Auth.Email.make("other@bymorning.ai"), role: "member" }),
      )
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("User.invite demotes an admin only while another admin remains", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const admin = yield* app.login()
      const workspaceID = admin.properties.workspaceID
      const second = { email: Auth.Email.make("second@bymorning.ai"), role: "admin" as const }
      const invite = (input: { email: Auth.Email; role: "admin" | "member" }) =>
        app.process(User.Service.use((users) => users.invite(workspaceID, input)))
      const admins = () =>
        Effect.tryPromise(() => app.client.user.list()).pipe(
          Effect.map((list) => list.members.filter((member) => member.role === "admin").map((member) => member.email)),
        )

      yield* invite(second)
      // Re-inviting an admin as admin is unchanged.
      expect(yield* invite(second)).toMatchObject({ email: second.email, role: "admin" })
      expect(yield* admins()).toHaveLength(2)
      // With two admins, one can be demoted.
      expect(yield* invite({ ...second, role: "member" })).toMatchObject({ role: "member" })
      expect(yield* admins()).toHaveLength(1)
      // The remaining admin is now the sole admin and cannot be demoted or removed.
      const self = (yield* Effect.tryPromise(() => app.client.user.list())).members.find(
        (entry) => entry.id === admin.properties.userID,
      )!
      const refused = yield* app
        .process(
          User.Service.use((users) =>
            users.invite(workspaceID, { email: Auth.Email.make(self.email), role: "member" }),
          ),
        )
        .pipe(Effect.flip)
      expect(refused).toMatchObject({ _tag: "User.LastAdminError" })
      const removal = yield* app
        .process(User.Service.use((users) => users.remove(workspaceID, self.id)))
        .pipe(Effect.flip)
      expect(removal).toMatchObject({ _tag: "User.LastAdminError" })
    }).pipe(Effect.scoped),
    { signal },
  )
})

test("concurrent demotions of two admins leave at least one admin", async ({ signal }) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* TestApp.make()
      const admin = yield* app.login()
      const workspaceID = admin.properties.workspaceID
      const first = Auth.Email.make("first@bymorning.ai")
      const second = Auth.Email.make("second@bymorning.ai")
      for (const email of [first, second])
        yield* app.process(User.Service.use((users) => users.invite(workspaceID, { email, role: "admin" })))
      // Three admins: demote all three at once; the last one standing must be refused.
      const self = (yield* Effect.tryPromise(() => app.client.user.list())).members.find(
        (entry) => entry.id === admin.properties.userID,
      )!
      const results = yield* Effect.all(
        [first, second, Auth.Email.make(self.email)].map((email) =>
          app
            .process(User.Service.use((users) => users.invite(workspaceID, { email, role: "member" })))
            .pipe(Effect.exit),
        ),
        { concurrency: "unbounded" },
      )
      expect(results.filter((exit) => exit._tag === "Failure")).toHaveLength(1)
      const members = (yield* Effect.tryPromise(() => app.client.user.list())).members
      expect(members.filter((member) => member.role === "admin")).toHaveLength(1)
    }).pipe(Effect.scoped),
    { signal },
  )
})
