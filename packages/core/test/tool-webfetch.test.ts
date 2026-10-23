import { Agent } from "@bymorning/schema/agent"
import { ID as MessageID } from "@bymorning/schema/message"
import { Project } from "@bymorning/schema/project"
import { Session } from "@bymorning/schema/session"
import { describe, expect, it } from "@effect/vitest"
import { ToolCallPart } from "@opencode-ai/ai/schema/messages"
import { Duration, Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { PluginHooks } from "../src/plugin/hooks.js"
import * as WebFetchTool from "../src/plugin/internal/tool/web-fetch.js"
import { resolvePublic, type Address } from "../src/plugin/internal/tool/web-fetch-egress.js"
import { Tool } from "../src/tool.js"

const sessionID = Session.ID.make("00000000-0000-4000-8000-000000000841")
const messageID = MessageID.make("00000000-0000-4000-8000-000000000842")
const agent = Agent.ID.make("build")
const projectID = Project.ID.make("prj_00000000000000000000000841")
const webFetchUserAgent =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ByMorning-User/1.0; +https://bymorning.ai"
const requests: Array<{ readonly url: string; readonly headers: Record<string, string> }> = []
const assertions: Tool.PermissionRequest[] = []
const dnsOverrides = new Map<string, ReadonlyArray<string>>()
const dnsQueries: string[] = []
let respond = (_request: HttpClientRequest.HttpClientRequest) =>
  Effect.succeed(new Response("hello", { headers: { "content-type": "text/plain" } }))

const http = HttpClient.make((request) =>
  Effect.sync(() => requests.push({ url: request.url, headers: request.headers })).pipe(
    Effect.andThen(respond(request)),
    Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
  ),
)

/** Real egress screening over a fixture DNS table; unknown hosts answer one public address. */
const fakeLookup = (hostname: string): Effect.Effect<ReadonlyArray<Address>, Tool.Error> => {
  dnsQueries.push(hostname)
  const answers = dnsOverrides.get(hostname) ?? (hostname === "localhost" ? ["127.0.0.1"] : ["93.184.216.34"])
  return Effect.succeed(answers.map((address) => ({ address, family: 4 as const })))
}
const resolve = (hostname: string) => resolvePublic(hostname, fakeLookup)

const reset = () => {
  requests.length = 0
  assertions.length = 0
  dnsOverrides.clear()
  dnsQueries.length = 0
  respond = () => Effect.succeed(new Response("hello", { headers: { "content-type": "text/plain" } }))
}

const context = (): Tool.Context => ({
  caller: { type: "session", sessionID, agent, messageID, projectID },
  id: Tool.CallID.make("call-webfetch"),
  progress: () => Effect.void,
  elicit: () => Effect.die("unused"),
  permission: (request) => Effect.sync(() => assertions.push(request)),
})

const run = (snapshot: Tool.Snapshot, input: typeof WebFetchTool.Input.Type, ctx = context()) =>
  snapshot.execute({
    call: ToolCallPart.make({ id: ctx.id, name: "webfetch", input }),
    context: ctx,
  })

const install = (client: HttpClient.HttpClient) =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    yield* tools.transform((editor) => editor.add(WebFetchTool.makeTool(client, resolve)))
    const snapshot = yield* tools.snapshot()
    expect(snapshot.definitions.map((definition) => definition.name)).toEqual(["webfetch", "execute"])
    return snapshot
  }).pipe(Effect.provide(Tool.layer.pipe(Layer.provide(PluginHooks.layer))), Effect.scoped)

/** Real construction through the pinned production transport. */
const installReal = Effect.gen(function* () {
  const tools = yield* Tool.Service
  const tool = yield* WebFetchTool.makeWebFetch
  yield* tools.transform((editor) => editor.add(tool))
  return yield* tools.snapshot()
})

/** A loopback HTTP server; the egress guard must prevent any connection to it. */
const server = (handler: (request: IncomingMessage, response: ServerResponse) => void) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<Server>((resolve) => {
          const value = createServer(handler).listen(0, "127.0.0.1", () => resolve(value))
        }),
    ),
    (value) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            value.closeAllConnections()
            value.close((error) => (error ? reject(error) : resolve()))
          }),
      ),
  ).pipe(
    Effect.map((value) => {
      const address = value.address()
      if (address === null || typeof address === "string") throw new Error("Server did not bind")
      return `http://127.0.0.1:${address.port}`
    }),
  )

describe("WebFetchTool helpers", () => {
  it("defaults format and rejects invalid timeout controls", () => {
    const decode = Schema.decodeUnknownSync(WebFetchTool.Input)
    expect(decode({ url: "https://example.com" })).toEqual({ url: "https://example.com", format: "markdown" })
    expect(() => decode({ url: "https://example.com", timeout: 0 })).toThrow()
    expect(() => decode({ url: "https://example.com", timeout: WebFetchTool.MAX_TIMEOUT_SECONDS + 1 })).toThrow()
  })

  it("ports HTML text and markdown conversions without active content", () => {
    const html =
      "<h1>Hello</h1><script>bad()</script><p>world <strong>wide</strong> <product-name>today</product-name></p><style>.bad {}</style>"
    expect(WebFetchTool.extractTextFromHTML(html)).toBe("Helloworld wide today")
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe("# Hello\n\nworld **wide** today")
  })

  it("renders headings, inline semantics, links, images, breaks, and thematic breaks", () => {
    const html = `<h2>Read <em>this</em></h2><p><a href="https://example.com/a (b)" title="Example">docs</a><br><img src="diagram.png" alt="a ] b"></p><hr><p><del>old</del></p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `## Read *this*\n\n[docs](https://example.com/a%20\\(b\\) "Example")  \n![a \\] b](diagram.png)\n\n---\n\n~~old~~`,
    )
  })

  it("preserves inline and preformatted code verbatim with safe fences", () => {
    const html = `<p>Use <code>say(\`hello\`)</code> now.</p><pre><code class="language-ts">const fence = \`\`\`\n&amp; stays decoded</code></pre>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `Use \`\`say(\`hello\`)\`\` now.\n\n~~~ts\nconst fence = \`\`\`\n& stays decoded\n~~~`,
    )
  })

  it("keeps nested ordered and unordered lists structurally readable", () => {
    const html = `<ol start="3"><li>alpha<ul><li>nested <strong>item</strong></li></ul></li><li><p>beta first</p><p>beta second</p></li></ol>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `3. alpha\n\n   - nested **item**\n\n4. beta first\n\n   beta second`,
    )
  })

  it("renders blockquotes and tables as readable Markdown", () => {
    const html = `<blockquote><p>quoted <em>text</em></p><ul><li>point</li></ul></blockquote><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>one</td><td><code>1</code></td></tr></tbody></table>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `> quoted *text*\n\n> - point\n\n| Name | Value |\n| --- | --- |\n| one | \`1\` |`,
    )
  })

  it("decodes entities and normalizes prose whitespace without joining words", () => {
    const html = `<p>alpha\n  <span>&amp; beta</span> <unknown>caf&eacute;</unknown>&nbsp;gamma 😀</p><p>delta</p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`alpha & beta café gamma 😀\n\ndelta`)
  })

  it("omits active and fallback content while retaining surrounding prose", () => {
    const html = `<p>before <script><b>bad</b></script><style>bad</style><noscript>bad</noscript><iframe>bad</iframe><object>bad</object><embed src="bad"><meta content="bad"><link href="bad"><template>bad</template> after</p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe("before after")
  })

  it("is deterministic and bounded for malformed input across parser chunks", () => {
    const html = `<main><p>${"visible &amp; text ".repeat(4_096)}</main></p></unknown>`
    const first = WebFetchTool.convertHTMLToMarkdown(html)
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(first)
    expect(first.startsWith("visible & text visible & text")).toBe(true)
    expect(first.length).toBeLessThanOrEqual(html.length)
  })

  it("defaults to the production byte budget with room for closing syntax", () => {
    const output = WebFetchTool.convertHTMLToMarkdown("x".repeat(WebFetchTool.MAX_RESPONSE_BYTES))
    expect(WebFetchTool.MAX_RESPONSE_BYTES).toBe(5 * 1024 * 1024)
    expect(output).toHaveLength(WebFetchTool.MAX_RESPONSE_BYTES - 64 * 1024)
  })

  it.each(["x", "\u00e9", "\u{1f600}"])("preserves UTF-8 boundaries at the content limit for %s", (character) => {
    const budget = WebFetchTool.MAX_RESPONSE_BYTES - 64 * 1024
    const fitting = "aa" + character.repeat(Math.floor((budget - 2) / Buffer.byteLength(character)))
    expect(WebFetchTool.convertHTMLToMarkdown(fitting)).toBe(fitting)
    const truncated = WebFetchTool.convertHTMLToMarkdown(fitting + character)
    expect(truncated).toBe(fitting)
    expect(Buffer.byteLength(truncated)).toBe(Buffer.byteLength(fitting))
  })

  it("bounds deeply nested list output and fragmented code fences", () => {
    const lists = `${"<ul><li>item".repeat(2_000)}${"</li></ul>".repeat(2_000)}`
    const quotes = `${"<blockquote><p>item".repeat(2_000)}${"</p></blockquote>".repeat(2_000)}`
    const code = `<pre>${"` x ".repeat(4_096)}</pre>`
    expect(WebFetchTool.convertHTMLToMarkdown(lists).length).toBeLessThan(lists.length * 4)
    expect(WebFetchTool.convertHTMLToMarkdown(quotes).length).toBeLessThan(quotes.length * 4)
    expect(() => WebFetchTool.convertHTMLToMarkdown(code)).not.toThrow()
    expect(
      WebFetchTool.convertHTMLToMarkdown(
        "<div>".repeat(20_000) + "safe<script><b>bad</b>&amp;</script><p>tail &amp;</p>",
      ),
    ).toBe("safe tail &")
  })

  it("escapes prose that would otherwise become Markdown structure", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p># heading</p><p>1. item</p><p>---</p><p>a | b</p>`)).toBe(
      `\\# heading\n\n1\\. item\n\n\\---\n\na \\| b`,
    )
  })

  it("preserves code whitespace and quotes every line of multiline blocks", () => {
    const html = `<blockquote><pre>line  \n\n\nnext</pre><table><tr><td>a|b</td><td>c</td></tr></table></blockquote>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `> \`\`\`\n> line  \n> \n> \n> next\n> \`\`\`\n\n> | a\\|b | c |\n> | --- | --- |`,
    )
  })

  it("keeps nested blockquotes inside their outer quote", () => {
    const html = `<blockquote><p>outer</p><blockquote><p>inner</p></blockquote><p>end</p></blockquote>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`> outer\n>\n> > inner\n>\n> end`)
  })

  it("keeps visible whitespace around inline emphasis", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p>a<strong> b</strong> c a <em>b </em>c</p>`)).toBe(`a **b** c a *b* c`)
    expect(WebFetchTool.convertHTMLToMarkdown(`a<strong> </strong>b a<em> </em>b`)).toBe(`a b a b`)
  })

  it("captures formatting elements inside preformatted content as code only", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<pre><b>x</b><i>y</i><del>z</del></pre>`)).toBe(`\`\`\`\nxyz\n\`\`\``)
  })

  it("normalizes multiline table cells without changing their columns", () => {
    const html = `<table><tr><td>x<br>y</td><td><code>a|b</code></td><td><p>first</p><p>second</p></td></tr></table>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`| x y | \`a\\|b\` | first second |\n| --- | --- | --- |`)
  })

  it("flattens nested tables without corrupting the outer table", () => {
    const html = `<table><tr><th>Parent</th><th>Sibling</th></tr><tr><td>Before<table><tr><th>Key</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>After</td><td>Tail</td></tr></table>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `| Parent | Sibling |\n| --- | --- |\n| Before Key Value A 1 After | Tail |`,
    )
  })

  it("preserves loose text around malformed table rows", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<table>before<tr><td>cell</td></tr>after</table>`)).toBe(
      `before after\n\n| cell |\n| --- |`,
    )
    expect(WebFetchTool.convertHTMLToMarkdown(`<table>alpha</table>`)).toBe(`alpha`)
  })

  it("escapes tilde fences and removes empty emphasis markers", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p>~~~</p><p><strong></strong>content</p><p>~~~</p>`)).toBe(
      `\\~\\~\\~\n\ncontent\n\n\\~\\~\\~`,
    )
  })

  it("does not confuse source NUL text with buffered code", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p>before \u00000\u0000 after</p><pre>code</pre>`)).toBe(
      `before \u00000\u0000 after\n\n\`\`\`\ncode\n\`\`\``,
    )
  })

  it("preserves multiline inline code verbatim", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p><code>first\n\n\nsecond  </code></p>`)).toBe("` first\n\n\nsecond   `")
  })

  it("prefixes inline code at the start of a blockquote line", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<blockquote><code>x</code> y</blockquote>`)).toBe(`> \`x\` y`)
  })

  it("keeps links nested in inline code associated with their text", () => {
    const html = `<dl><dt><code>socket = new <a href="#constructor">WebSocket</a>(url)</code><dd>Creates one.</dl>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `**\` socket = new  \`[\`WebSocket\`](#constructor)\`(url)\`**\n: Creates one.`,
    )
    expect(WebFetchTool.convertHTMLToMarkdown(`<code><a href="#x">x</a></code> after`)).toBe(`[\`x\`](#x) after`)
    expect(
      WebFetchTool.convertHTMLToMarkdown(
        `<dl><dt><code><var>socket</var> = new <code><a href="#constructor">WebSocket</a></code>(<var>url</var>)</code><dd>Creates one.</dl>`,
      ),
    ).toBe(`**\` socket = new  \`[\`WebSocket\`](#constructor)\`(url)\`**\n: Creates one.`)
    expect(WebFetchTool.convertHTMLToMarkdown(`<code>a<a href="/x">b<a href="/y">c</a>d</a>e</code>`)).toBe(
      `\`a\`[\`b\`](\/x)[\`c\`](\/y)\`de\``,
    )
    expect(WebFetchTool.convertHTMLToMarkdown(`<code>a<a href="/x">b</code>c`)).toBe(`\`a\`[\`b\`](\/x)c`)
    expect(WebFetchTool.convertHTMLToMarkdown(`<code>a<a href="/x"><div>b</div>c</a>d</code>`)).toBe(
      `\`a\`[](\/x)\n\n\`bcd\``,
    )
  })

  it("indents nested list continuations and preserves ordered numbering", () => {
    const html = `<ol start="0"><li value="4"><p>first</p><p>continued</p><ul><li><p>nested</p><p>continued nested</p></li></ul></li><li>next</li></ol>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `4. first\n\n   continued\n\n   - nested\n\n     continued nested\n\n5. next`,
    )
  })

  it("renders block content outside link syntax", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<a href="/docs">before<div>block</div>after</a>`)).toBe(
      `[before](/docs)\n\nblock\n\n[after](/docs)`,
    )
  })

  it("recovers nested anchors without unmatched Markdown syntax", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<a href="/a">x<a href="/b">y</a>z</a>`)).toBe(`[x](/a)[y](/b)z`)
  })

  it("keeps emphasis whitespace through neutral wrappers", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p>a<strong><span> bold</span></strong>c</p>`)).toBe(`a **bold** c`)
  })

  it("flattens preformatted content inside table cells", () => {
    const html = `<table><tr><td><pre>a|b\nnext</pre></td><td><code>x|y</code></td></tr></table>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`| a\\|b next | \`x\\|y\` |\n| --- | --- |`)
  })

  it("preserves Unicode in inline constructs", () => {
    const payload = "😀".repeat(16)
    const cases = [
      [`<strong>${payload}</strong>`, `**${payload}**`],
      [`<a href="/docs">${payload}</a>`, `[${payload}](/docs)`],
      [`<img src="image.png" alt="${payload}">`, `![${payload}](image.png)`],
      [`<code>${payload}</code>`, `\`${payload}\``],
    ] as const
    for (const [html, expected] of cases) {
      expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(expected)
    }
  })

  it("preserves block content and following lists", () => {
    const payload = "x".repeat(256)
    const table = WebFetchTool.convertHTMLToMarkdown(
      `<table><tr><th>Name</th></tr><tr><td>${payload}</td></tr></table>`,
    )
    const list = WebFetchTool.convertHTMLToMarkdown(`<ul><li>${payload}</li></ul><ul><li>next</li></ul>`)
    const code = WebFetchTool.convertHTMLToMarkdown(`<pre>${payload}</pre>`)
    expect(table).toBe(`| Name |\n| --- |\n| ${payload} |`)
    expect(list).toBe(`- ${payload}\n\n- next`)
    expect(code).toBe(`\`\`\`\n${payload}\n\`\`\``)
  })

  it("keeps quoted code with long delimiter runs inside a safe closed fence", () => {
    const payload = `${"`".repeat(32)}${"~".repeat(32)}${"x".repeat(64)}`
    const output = WebFetchTool.convertHTMLToMarkdown(`<blockquote><pre>${payload}</pre></blockquote>`)
    expect(output).toBe(`> ${"`".repeat(33)}\n> ${payload}\n> ${"`".repeat(33)}`)
  })

  it("separates reconstructed tables from adjacent inline and quoted content", () => {
    const html = `intro<table><tr><td>x</td></tr></table>outro<blockquote>quote<table><tr><td>cell</td></tr></table></blockquote><ul><li>item<table><tr><td>cell</td></tr></table></li></ul>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `intro\n\n| x |\n| --- |\n\noutro\n\n> quote\n\n> | cell |\n> | --- |\n\n- item\n\n| cell |\n| --- |`,
    )
  })

  it("keeps multiline quoted code closed before following prose", () => {
    const html = `<blockquote><pre>${"x\n".repeat(16)}</pre></blockquote><p>tail</p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`> \`\`\`\n${"> x\n".repeat(16)}> \`\`\`\n\ntail`)
  })

  it("keeps active content suppressed when depth fallback begins", () => {
    const html = `<object>${"<div>".repeat(10_001)}LEAK${"</div>".repeat(10_001)}</object><p>visible</p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe("visible")
  })

  it("keeps visible text after depth fallback begins inside preformatted content", () => {
    const html = `<pre>${"<i>".repeat(10_001)}visible${"</i>".repeat(10_001)}</pre><p>after</p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe("visible after")
  })

  it("resumes links around every block structure", () => {
    const html = `<a href="/x">before<blockquote><p>quote</p></blockquote><ul><li>item</li></ul><pre>code</pre><table><tr><td>cell</td></tr></table>after</a>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `[before](/x)\n\n> quote\n\n- item\n\n\`\`\`\ncode\n\`\`\`\n\n| cell |\n| --- |\n\n[after](/x)`,
    )
  })

  it("indents child lists from the actual parent marker width", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<ol start="100"><li>outer<ul><li>inner</li></ul></li></ol>`)).toBe(
      `100. outer\n\n     - inner`,
    )
  })

  it("renders captions and definition lists with readable boundaries", () => {
    const html = `<table><caption>Cache modes</caption><tr><th>Name</th><th>Meaning</th></tr><tr><td>A</td><td>Local</td></tr></table><dl><dt>Cache</dt><dd>A local store</dd><dt>Origin</dt><dd>The remote source</dd></dl>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `Cache modes\n\n| Name | Meaning |\n| --- | --- |\n| A | Local |\n\n**Cache**\n: A local store\n\n**Origin**\n: The remote source`,
    )
  })

  it("falls back to row-oriented text for table spans", () => {
    const html = `<table><tr><th colspan="2">Group</th></tr><tr><td>A</td><td rowspan="2">Shared</td></tr><tr><td>B</td></tr></table>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`Group\n\nA | Shared\n\nB`)
  })

  it("suppresses head and hidden subtrees while retaining visible body content", () => {
    const html = `<head><title>noise</title></head><body><p>visible</p><div hidden>hidden</div><div aria-hidden="true">aria</div><div aria-hidden="false">shown</div></body>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`visible\n\nshown`)
  })

  it("preserves pre breaks and normalizes multiline link titles", () => {
    const html = `<pre>first<br>second</pre><p><a href="/x" title="line one\n  line two">link</a></p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `\`\`\`\nfirst\nsecond\n\`\`\`\n\n[link](/x "line one line two")`,
    )
  })

  it("renders closed and open details according to visibility", () => {
    const html = `<details><summary>Closed</summary><p>secret</p></details><details open><summary>Open</summary><p>visible</p></details>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`Closed\n\nOpen\n\nvisible`)
  })
})

describe("WebFetchTool registration", () => {
  it.effect("registers and fetches an ordinary hostname HTTP URL without rewriting it", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)
      const url = "http://example.com/public"

      expect(yield* run(snapshot, { url, format: "text", timeout: 4 })).toEqual({
        output: { url, contentType: "text/plain", format: "text", output: "hello" },
        content: [{ type: "text", text: "hello" }],
        metadata: { contentType: "text/plain" },
      })
      expect(assertions).toMatchObject([
        { action: "webfetch", resources: [url], save: ["*"], metadata: { url, format: "text", timeout: 4 } },
      ])
      expect(requests).toMatchObject([
        {
          url,
          headers: {
            accept: "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1",
            "accept-language": "en-US,en;q=0.9",
            "user-agent": webFetchUserAgent,
          },
        },
      ])
      expect(requests[0]?.headers).not.toHaveProperty("sec-fetch-mode")
    }),
  )

  it.effect("[SEC-SSRF-01] refuses loopback, private, link-local, CGNAT, and metadata destinations before any request", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)
      const blocked = [
        "http://localhost/private",
        "http://127.0.0.1/private",
        "http://127.1/private",
        "http://0x7f000001/private",
        "http://2130706433/private",
        "http://0.0.0.0/private",
        "http://10.0.0.8/private",
        "http://172.16.0.1/private",
        "http://172.31.255.255/private",
        "http://192.168.1.1/private",
        "http://169.254.169.254/latest/meta-data",
        "http://169.254.170.2/latest/task",
        "http://100.64.0.1/private",
        "http://[::1]/private",
        "http://[::]/private",
        "http://[fd00::1]/private",
        "http://[fc00::1]/private",
        "http://[fe80::1]/private",
        "http://[::ffff:127.0.0.1]/private",
        "http://[::ffff:169.254.169.254]/latest/meta-data",
        "http://[::ffff:10.0.0.8]/private",
        "http://224.0.0.1/private",
        "http://255.255.255.255/private",
      ]
      for (const url of blocked) {
        const error = yield* run(snapshot, { url, format: "text" }).pipe(Effect.flip)
        expect(error._tag).toBe("Tool.Error")
        expect((error as Tool.Error).message).toContain("non-public")
      }
      // Blocked destinations never prompt for permission and never reach the transport.
      expect(assertions).toEqual([])
      expect(requests).toEqual([])
    }),
  )

  it.effect("[SEC-SSRF-02] refuses hostnames resolving to non-public or mixed answers", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)
      dnsOverrides.set("metadata.internal", ["169.254.169.254"])
      dnsOverrides.set("rebind.internal", ["93.184.216.34", "127.0.0.1"])
      dnsOverrides.set("dead.internal", [])
      for (const hostname of ["metadata.internal", "rebind.internal", "dead.internal"]) {
        const error = yield* run(snapshot, { url: `http://${hostname}/`, format: "text" }).pipe(Effect.flip)
        expect(error._tag).toBe("Tool.Error")
      }
      expect(dnsQueries).toEqual(["metadata.internal", "rebind.internal", "dead.internal"])
      expect(requests).toEqual([])
    }),
  )

  it.effect("[SEC-SSRF-03] re-screens every redirect hop and refuses a private target", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)
      dnsOverrides.set("public.fixture", ["93.184.216.34"])
      dnsOverrides.set("internal.fixture", ["192.168.0.1"])
      respond = (request) =>
        Effect.succeed(
          request.url.includes("public.fixture")
            ? new Response(null, { status: 302, headers: { location: "http://internal.fixture/" } })
            : new Response("unreachable", { headers: { "content-type": "text/plain" } }),
        )
      const url = "http://public.fixture/start"

      const error = yield* run(snapshot, { url, format: "text" }).pipe(Effect.flip)
      expect((error as Tool.Error).message).toContain("non-public")
      // The first hop was fetched; the private target was screened before connecting.
      expect(requests.map((request) => request.url)).toEqual([url])
      expect(dnsQueries).toEqual(["public.fixture", "public.fixture", "internal.fixture"])
      // Permission is granted only for the URL the caller requested.
      expect(assertions).toMatchObject([{ action: "webfetch", resources: [url] }])
    }),
  )

  it.effect("follows redirects while approving only the requested URL", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)
      dnsOverrides.set("public.fixture", ["93.184.216.34"])
      respond = (request) =>
        Effect.succeed(
          request.url === "http://public.fixture/redirect"
            ? new Response(null, { status: 302, headers: { location: "/target" } })
            : new Response("redirected", { headers: { "content-type": "text/plain" } }),
        )
      const url = "http://public.fixture/redirect"

      expect(yield* run(snapshot, { url, format: "text" })).toMatchObject({
        content: [{ type: "text", text: "redirected" }],
      })
      expect(requests.map((request) => request.url)).toEqual([url, "http://public.fixture/target"])
      expect(requests[0]?.headers).not.toHaveProperty("sec-fetch-mode")
      expect(assertions).toMatchObject([
        { action: "webfetch", resources: [url], save: ["*"], metadata: { url, format: "text" } },
      ])
      // The same screened host is consulted once before permission and once per hop.
      expect(dnsQueries).toEqual(["public.fixture", "public.fixture", "public.fixture"])
    }),
  )

  it.effect("[SEC-SSRF-08] the production pinned transport refuses loopback before any connection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        reset()
        const received: string[] = []
        const origin = yield* server((request, response) => {
          received.push(request.url ?? "")
          response.writeHead(200, { "content-type": "text/plain" })
          response.end("secret")
        })
        const snapshot = yield* installReal.pipe(
          Effect.provide(Tool.layer.pipe(Layer.provide(PluginHooks.layer))),
        )

        const error = yield* run(snapshot, { url: `${origin}/private`, format: "text" }).pipe(Effect.flip)
        expect((error as Tool.Error).message).toContain("non-public")
        expect(received).toEqual([])
      }),
    ),
  )

  it.effect("stops following after the redirect budget", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)
      respond = () => Effect.succeed(new Response(null, { status: 302, headers: { location: "/loop" } }))
      const url = "http://public.fixture/loop"

      const error = yield* run(snapshot, { url, format: "text" }).pipe(Effect.flip)
      expect((error as Tool.Error).message).toContain("Too many redirects")
      expect(requests).toHaveLength(WebFetchTool.MAX_REDIRECTS + 1)
    }),
  )

  it.effect("rejects non-HTTP schemes before permission or transport", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)

      expect(yield* run(snapshot, { url: "file:///etc/passwd", format: "text" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Tool.Error",
        message: "URL must use http:// or https://",
      })
      expect(assertions).toEqual([])
      expect(requests).toEqual([])
    }),
  )

  it.effect("converts HTML to requested markdown and text", () =>
    Effect.gen(function* () {
      reset()
      respond = () =>
        Effect.succeed(
          new Response("<h1>Hello</h1><p>world</p><script>bad()</script>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        )
      const snapshot = yield* install(http)

      expect(yield* run(snapshot, { url: "https://1.1.1.1", format: "markdown" })).toMatchObject({
        content: [{ type: "text", text: "# Hello\n\nworld" }],
      })
      expect(yield* run(snapshot, { url: "https://1.1.1.1", format: "text" })).toMatchObject({
        content: [{ type: "text", text: "Helloworld" }],
      })
    }),
  )

  it.effect("converts deeply nested HTML without overflowing", () =>
    Effect.gen(function* () {
      reset()
      respond = () =>
        Effect.succeed(
          new Response("<div>".repeat(10_000) + "content" + "</div>".repeat(10_000), {
            headers: { "content-type": "text/html" },
          }),
        )
      const snapshot = yield* install(http)
      const url = "https://1.1.1.1/deep-html"

      expect(yield* run(snapshot, { url, format: "markdown" })).toMatchObject({
        content: [{ type: "text", text: "content" }],
      })
    }),
  )

  it.effect("rejects declared and streamed oversized bodies", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)
      respond = () =>
        Effect.succeed(
          new Response("small", {
            headers: { "content-type": "text/plain", "content-length": String(WebFetchTool.MAX_RESPONSE_BYTES + 1) },
          }),
        )
      expect(yield* run(snapshot, { url: "https://1.1.1.1/declared", format: "text" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Tool.Error",
        message: `Response too large (exceeds ${WebFetchTool.MAX_RESPONSE_BYTES} byte limit)`,
      })

      respond = () =>
        Effect.succeed(
          new Response("x".repeat(WebFetchTool.MAX_RESPONSE_BYTES + 1), { headers: { "content-type": "text/plain" } }),
        )
      expect(yield* run(snapshot, { url: "https://1.1.1.1/streamed", format: "text" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Tool.Error",
        message: `Response too large (exceeds ${WebFetchTool.MAX_RESPONSE_BYTES} byte limit)`,
      })
    }),
  )

  it.effect("keeps images and files unsupported until typed outcomes can carry attachments", () =>
    Effect.gen(function* () {
      reset()
      const snapshot = yield* install(http)
      respond = () => Effect.succeed(new Response("png", { headers: { "content-type": "image/png" } }))
      expect(yield* run(snapshot, { url: "https://1.1.1.1/image", format: "html" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Tool.Error",
        message: "Unsupported fetched image content type: image/png",
      })

      respond = () => Effect.succeed(new Response("pdf", { headers: { "content-type": "application/pdf" } }))
      expect(yield* run(snapshot, { url: "https://1.1.1.1/file", format: "html" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Tool.Error",
        message: "Unsupported fetched file content type: application/pdf",
      })
    }),
  )

  it.effect("retries Cloudflare challenges with an honest user agent", () =>
    Effect.gen(function* () {
      reset()
      let count = 0
      respond = () =>
        Effect.succeed(
          ++count === 1
            ? new Response("challenge", { status: 403, headers: { "cf-mitigated": "challenge" } })
            : new Response("ok", { headers: { "content-type": "text/plain" } }),
        )
      const snapshot = yield* install(http)

      expect(yield* run(snapshot, { url: "https://1.1.1.1", format: "text" })).toMatchObject({
        content: [{ type: "text", text: "ok" }],
      })
      expect(requests).toHaveLength(2)
      expect(requests[0]?.headers["user-agent"]).toBe(webFetchUserAgent)
      expect(requests[1]?.headers["user-agent"]).toBe("bymorning")
    }),
  )

  it.effect("does not retry ordinary 403 responses", () =>
    Effect.gen(function* () {
      reset()
      respond = () => Effect.succeed(new Response("forbidden", { status: 403 }))
      const snapshot = yield* install(http)
      const url = "https://example.com/forbidden"

      expect(yield* run(snapshot, { url, format: "text" }).pipe(Effect.flip)).toMatchObject({
        _tag: "Tool.Error",
        message: `StatusCode: non 2xx status code (403 GET ${url})`,
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.headers["user-agent"]).toBe(webFetchUserAgent)
    }),
  )

  it.effect("times out stalled requests", () =>
    Effect.gen(function* () {
      reset()
      respond = () => Effect.never
      const snapshot = yield* install(http)
      const fiber = yield* run(snapshot, { url: "https://1.1.1.1/slow", format: "text", timeout: 1 }).pipe(
        Effect.flip,
        Effect.forkChild,
      )
      yield* TestClock.adjust(Duration.seconds(1))

      expect(yield* Fiber.join(fiber)).toMatchObject({
        _tag: "Tool.Error",
        message: "Request timed out",
      })
    }),
  )
})
