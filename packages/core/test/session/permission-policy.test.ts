import { Session } from "@bymorning/schema/session"
import { User } from "@bymorning/schema/user"
import { describe, expect, it } from "vitest"
import { Permission } from "../../src/permission.js"
import { whollyDenied } from "../../src/permission/evaluation.js"
import { effectiveRules } from "../../src/session/permission.js"

const childParentID = Session.ID.make("00000000-0000-4000-8000-000000000721")

describe("Session effective permissions", () => {
  it("uses root Agent rules when Workspace has no matching rule", () => {
    const rules = effectiveRules(null, [{ action: "read", resource: "*", effect: "allow" }], [])

    expect(Permission.evaluate("read", "README.md", rules).effect).toBe("allow")
    expect(Permission.evaluate("subagent", "general", rules).effect).toBe("allow")
  })

  it("places authoritative Workspace rules after matching Agent rules", () => {
    const rules = effectiveRules(
      null,
      [{ action: "read", resource: "*", effect: "allow" }],
      [{ action: "read", resource: "*", effect: "deny" }],
    )

    expect(Permission.evaluate("read", "README.md", rules).effect).toBe("deny")
  })

  it("places matching User rules after Workspace rules without applying another member's rules", () => {
    const user = User.ID.make("usr_permission_target")
    const other = User.ID.make("usr_permission_other")
    const rules = effectiveRules(
      null,
      [{ action: "read", resource: "*", effect: "allow" }],
      [
        { action: "read", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow", user },
        { action: "read", resource: "*", effect: "deny", user: other },
      ],
      user,
    )

    expect(Permission.evaluate("read", "README.md", rules).effect).toBe("allow")
  })

  it("allows ordinary child actions while always denying recursive Subagent use", () => {
    const rules = effectiveRules(childParentID, [], [])

    expect(Permission.evaluate("read", "README.md", rules).effect).toBe("allow")
    expect(Permission.evaluate("subagent", "general", rules).effect).toBe("deny")
  })

  it("preserves target restrictions after the permissive child baseline", () => {
    const rules = effectiveRules(childParentID, [], [{ action: "read", resource: "*", effect: "deny" }])

    expect(Permission.evaluate("read", "README.md", rules).effect).toBe("deny")
    expect(Permission.evaluate("write", "README.md", rules).effect).toBe("allow")
  })

  it("makes the terminal child Subagent deny authoritative", () => {
    const rules = effectiveRules(
      childParentID,
      [{ action: "subagent", resource: "*", effect: "allow" }],
      [{ action: "subagent", resource: "*", effect: "allow" }],
    )

    expect(Permission.evaluate("subagent", "general", rules).effect).toBe("deny")
  })

  it("allows Workspace rules to override the missing-Agent fallback", () => {
    const rules = effectiveRules(
      null,
      [{ action: "*", resource: "*", effect: "deny" }],
      [{ action: "read", resource: "*", effect: "allow" }],
    )

    expect(Permission.evaluate("read", "README.md", rules).effect).toBe("allow")
    expect(Permission.evaluate("write", "README.md", rules).effect).toBe("deny")
  })
})

describe("Permission catalog visibility", () => {
  it("hides only an action whose final action rule denies every resource", () => {
    expect(
      whollyDenied("read", [
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "secret", effect: "deny" },
      ]),
    ).toBe(false)
    expect(
      whollyDenied("read", [
        { action: "read", resource: "secret", effect: "deny" },
        { action: "read", resource: "*", effect: "deny" },
      ]),
    ).toBe(true)
    expect(
      whollyDenied("read", [
        { action: "read", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "ask" },
      ]),
    ).toBe(false)
  })
})
