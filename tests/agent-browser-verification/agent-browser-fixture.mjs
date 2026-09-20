import fs from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("agent-browser 0.38.1\n");
  process.exit(0);
}
const commandIndex = args.findIndex((value) => ["open", "click", "focus", "fill", "press", "snapshot", "is", "get", "close", "screenshot"].includes(value));
const command = commandIndex >= 0 ? args[commandIndex] : "";
const subcommand = command === "is" || command === "get" ? args[commandIndex + 1] : "";
const outputPath = command === "screenshot" ? args[commandIndex + 1] : null;
if (outputPath) fs.writeFileSync(outputPath, Buffer.from("fake-png"));
let data = {};
if (command === "snapshot") data = { refs: { e1: { role: "textbox", name: "Email" }, e2: { role: "button", name: "Submit" } } };
else if (command === "get" && subcommand === "url") data = "https://example.test:8443/start";
else if (command === "get" && subcommand === "title") data = "Checkout";
else if (command === "get" && subcommand === "text") data = "Checkout";
else if (command === "get" && subcommand === "value") data = "user@example.test";
else if (command === "get" && subcommand === "attr") data = "value";
else if (command === "is") data = true;
process.stdout.write(JSON.stringify({ success: true, data }));
