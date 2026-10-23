import { Plugin } from "@bymorning/plugin"

const instruction = `# Company context

Use the Company Handbook reference when a request depends on company policy, operating procedures, ownership, service expectations, or release requirements. Search the reference before stating a policy as fact. Cite the handbook path you used and distinguish documented requirements from a recommendation when the handbook is incomplete or conflicts with the request.`

function source(options: Readonly<Record<string, unknown>>) {
  const type = options.source === "git" ? "git" : options.source === "local" ? "local" : undefined
  if (!type) throw new Error('Company context option "source" must be "local" or "git"')

  if (type === "local") {
    const path = options.path
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error('Company context option "path" must be an absolute path for a local reference')
    }
    return { type, path, description: "Company Handbook" } as const
  }

  const repository = options.repository
  if (typeof repository !== "string" || !URL.canParse(repository)) {
    throw new Error('Company context option "repository" must be a valid credential-free HTTPS Git URL')
  }
  const url = new URL(repository)
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(
      'Company context option "repository" must be a credential-free HTTPS Git URL without query or fragment',
    )
  }
  return { type, repository, description: "Company Handbook" } as const
}

/** Adds a company handbook reference and guidance for using it. */
export default Plugin.define({
  id: "example.company-context",
  configuration: {
    title: "Company context",
    description: "Choose the Company Handbook location. This configuration never stores credentials.",
    fields: [
      {
        key: "source",
        type: "string",
        title: "Handbook source",
        default: "local",
        options: [
          { value: "local", label: "Local path" },
          { value: "git", label: "Git repository" },
        ],
      },
      {
        key: "path",
        type: "string",
        title: "Handbook path",
        description: "An absolute path readable by the ByMorning server.",
        default: "/workspace/company-handbook",
        required: true,
        when: [{ key: "source", op: "eq", value: "local" }],
      },
      {
        key: "repository",
        type: "string",
        title: "Handbook repository",
        description: "A credential-free HTTPS Git URL without a query or fragment, reachable by the ByMorning server.",
        default: "https://github.com/example/company-handbook.git",
        format: "uri",
        required: true,
        when: [{ key: "source", op: "eq", value: "git" }],
      },
    ],
  },
  async setup(context) {
    const handbook = source(context.options)
    await Promise.all([
      context.instruction.transform((editor) => editor.add({ path: "company-context.md", content: instruction })),
      context.reference.transform((editor) => editor.add("company-handbook", handbook)),
    ])
  },
})
