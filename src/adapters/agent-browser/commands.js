const SAFE_GLOBAL_FLAGS = Object.freeze(["--content-boundaries", "--no-webmcp"]);

function globalArgs({ sessionId, allowedOrigins, maxOutputChars = 50_000 } = {}) {
  const domains = [...new Set((allowedOrigins ?? []).map((origin) => new URL(origin).hostname.toLowerCase()))].join(",");
  return [
    "--session", sessionId,
    "--allowed-domains", domains,
    "--max-output", String(maxOutputChars),
    ...SAFE_GLOBAL_FLAGS,
  ];
}

function command({ sessionId, allowedOrigins, maxOutputChars, name, args = [], json = true }) {
  return [
    ...globalArgs({ sessionId, allowedOrigins, maxOutputChars }),
    name,
    ...args,
    ...(json ? ["--json"] : []),
  ];
}

export function versionCommand() { return ["--version"]; }
export function openCommand(input) { return command({ ...input, name: "open", args: [input.url] }); }
export function clickCommand(input) { return command({ ...input, name: "click", args: [input.selector] }); }
export function focusCommand(input) { return command({ ...input, name: "focus", args: [input.selector] }); }
export function fillCommand(input) { return command({ ...input, name: "fill", args: [input.selector, input.text] }); }
export function pressCommand(input) { return command({ ...input, name: "press", args: [input.key] }); }
export function snapshotCommand(input) { return command({ ...input, name: "snapshot", args: ["-i"] }); }
export function visibleCommand(input) { return command({ ...input, name: "is", args: ["visible", input.selector] }); }
export function textCommand(input) { return command({ ...input, name: "get", args: ["text", input.selector] }); }
export function valueCommand(input) { return command({ ...input, name: "get", args: ["value", input.selector] }); }
export function attributeCommand(input) { return command({ ...input, name: "get", args: ["attr", input.selector, input.attribute] }); }
export function urlCommand(input) { return command({ ...input, name: "get", args: ["url"] }); }
export function titleCommand(input) { return command({ ...input, name: "get", args: ["title"] }); }
export function screenshotCommand(input) { return command({ ...input, name: "screenshot", args: [input.outputPath], json: true }); }
export function closeCommand(input) { return command({ ...input, name: "close", args: [] }); }

export const AGENT_BROWSER_COMMANDS = Object.freeze({
  version: versionCommand,
  open: openCommand,
  click: clickCommand,
  focus: focusCommand,
  fill: fillCommand,
  press: pressCommand,
  snapshot: snapshotCommand,
  visible: visibleCommand,
  text: textCommand,
  value: valueCommand,
  attribute: attributeCommand,
  url: urlCommand,
  title: titleCommand,
  screenshot: screenshotCommand,
  close: closeCommand,
});
