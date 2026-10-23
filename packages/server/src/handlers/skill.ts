import { Skill } from "@bymorning/core/skill"
import { SkillError } from "@bymorning/protocol/errors"
import { SkillSchema } from "@bymorning/schema/skill"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api.js"
import { forbidden, requireAdmin } from "../middleware/admin.js"

const notFound = (error: Skill.NotFoundError) =>
  new SkillError({ skillID: error.skillID, message: `Skill not found: ${error.skillID}` })

/** Skill management endpoint implementations. */
export const SkillHandler = HttpApiBuilder.group(Api, "api.skill", (handlers) =>
  handlers
    .handle("skill.list", () => Skill.Service.use((skill) => skill.list))
    .handle("skill.get", ({ params }) =>
      Skill.Service.use((skill) => skill.get(params.skillID).pipe(Effect.catchTag("Skill.NotFoundError", notFound))),
    )
    .handle("skill.create", ({ payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const skill = yield* Skill.Service
        return yield* skill.create(payload).pipe(Effect.catchTag("Actor.ForbiddenError", forbidden))
      }),
    )
    .handle("skill.update", ({ params, payload }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const skill = yield* Skill.Service
        return yield* skill
          .update(SkillSchema.Info.make({ id: params.skillID, ...payload }))
          .pipe(
            Effect.catchTag("Skill.NotFoundError", notFound),
            Effect.catchTag("Actor.ForbiddenError", forbidden),
          )
      }),
    )
    .handle("skill.delete", ({ params }) =>
      Effect.gen(function* () {
        yield* requireAdmin
        const skill = yield* Skill.Service
        yield* skill
          .delete(params.skillID)
          .pipe(
            Effect.catchTag("Skill.NotFoundError", notFound),
            Effect.catchTag("Actor.ForbiddenError", forbidden),
          )
        return HttpApiSchema.NoContent.make()
      }),
    ),
)
