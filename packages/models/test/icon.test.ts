import { describe, expect, it } from "vitest"
import { sanitizeIcon } from "../src/icon.js"

describe("SVG sanitation", () => {
  it("renders a stable monochrome AST", () => {
    const source =
      '<svg height="24" viewBox="0, 0, 24, 24" width="24" xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0h1"/></svg>'
    expect(sanitizeIcon(source)).toEqual(sanitizeIcon(source))
    expect(sanitizeIcon(source).svg).toBe(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1" fill="currentColor"/></svg>',
    )
  })

  it("emits the SVG namespace when the source omits it", () => {
    expect(sanitizeIcon('<svg viewBox="0 0 1 1"/>').svg).toBe(
      '<svg viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg"/>',
    )
  })

  it.each([
    '<?xml version="1.0"?><svg viewBox="0 0 1 1"/>',
    '<!DOCTYPE svg [<!ENTITY x "x">]><svg viewBox="0 0 1 1"><path d="&x;"/></svg>',
    '<svg viewBox="0 0 1 1"><script/></svg>',
    '<svg viewBox="0 0 1 1"><foreignObject/></svg>',
    '<svg viewBox="0 0 1 1"><path onclick="x"/></svg>',
    '<svg viewBox="0 0 1 1"><path fill="url(javascript:alert(1))"/></svg>',
    '<svg viewBox="0 0 1 1"><path href="javascript&#58;x"/></svg>',
    '<svg viewBox="0 0 1 1"><svg:path/></svg>',
    '<svg viewBox="0 0 1 1"><Script/></svg>',
    '<svg viewBox="0 0 1 1"><path fill="red"/><path fill="blue"/></svg>',
    '<svg viewBox="0 0 1 1"><path></svg>',
    '<!DOCTYPE svg [<!ENTITY % x SYSTEM "https://example.com/x">%x;]><svg viewBox="0 0 1 1"/>',
    '<svg xmlns:xi="http://www.w3.org/2001/XInclude" viewBox="0 0 1 1"><xi:include href="file:///etc/passwd"/></svg>',
    '<svg viewBox="0 0 1 1" viewBox="0 0 2 2"/>',
    '<svg viewBox="0 0 1 1"><path xmlns:xlink="http://www.w3.org/1999/xlink"/></svg>',
    '<svg viewBox="0 0 1 1"><path fill="jAvAsCrIpT&#58;alert(1)" d="M0 0"/></svg>',
    '<svg viewBox="0 0 1 1"><use href="https://example.com/a.svg#x"/></svg>',
    '<svg viewBox="0 0 1 1"><image href="data:image/png;base64,eA=="/></svg>',
    '<svg viewBox="0 0 1 1"><filter/></svg>',
    '<svg viewBox="0 0 1 1"><animate attributeName="d"/></svg>',
    '<svg viewBox="0 0 1 1"><path d="M nope"/></svg>',
    '<svg viewBox="0 0 1 1"><circle r="-1"/></svg>',
    '<svg viewBox="0 0 1 1"><path opacity="2" d="M0 0"/></svg>',
    '<svg viewBox="0 0 1 1"><polygon points="0,0,1"/></svg>',
    '<svg viewBox="0 0 1 1"><circle cx="1e999" r="1"/></svg>',
    '<svg viewBox="0 0 1 1"><polygon points="0,0 1e999,1"/></svg>',
    '<svg viewBox="0 0 1 1"><path transform="scale(1e999)" d="M0 0"/></svg>',
    '<svg viewBox="0 0 1 1"><path transform="matrix(1 0)" d="M0 0"/></svg>',
    '<svg viewBox="0 0 1 1"><path d="M0 0L1e999 1"/></svg>',
    '<svg viewBox="0 0 1 1"><path d="M0 0A1 1 0 2 0 1 1"/></svg>',
    '<svg viewBox="0 0 1 1"><path d="M0 0A1 1 0 0 -1 1 1"/></svg>',
    '<svg viewBox="0 0 1 1"><path d="M0 0A-1 1 0 0 1 1 1"/></svg>',
    `<svg viewBox="0 0 1 1">${'<path d="M0 0"/>'.repeat(2_049)}</svg>`,
    `<svg viewBox="0 0 1 1"><path d="M0 0" data-x="${"x".repeat(65_536)}"/></svg>`,
  ])("rejects active or malformed input", (source) => expect(() => sanitizeIcon(source)).toThrow())
})
