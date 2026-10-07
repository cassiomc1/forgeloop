import {
  CLI_COMMAND_DEFINITIONS,
  classifyForgeLoopInvocation,
  executeForgeLoopCommand,
  FORGELOOP_INTEGRATION_API_VERSION,
} from "@cassiomc1/forgeloop/integration";
import { fromJsonSchema } from "@modelcontextprotocol/server";

import { invocationAllowed, annotationsFor, toolEnabled } from "./capability-policy.js";
import { applyExecutionPolicy } from "./execution-policy.js";
import { enforceStructuredInputBound } from "./input-policy.js";
import { jsonSchemaForCommand } from "./schema-adapter.js";
import { envelopeToToolResult, capabilityRefusalResult } from "./error-mapping.js";

export function commandToToolName(command) {
  return `forgeloop_${command.replaceAll("-", "_")}`;
}

/**
 * Deterministic tool catalog: derived only from static ForgeLoop command
 * metadata plus the immutable launch policy. Project state never changes the
 * tool list.
 *
 * `authorityContextProvider` is an embedding-host hook: it is the ONLY way a
 * trusted host authority context can enter an MCP tool invocation. Tool
 * arguments can never mint HOST_ATTESTED; the registry strips any
 * actor-supplied `authorityContext` property from args before dispatch.
 */
export function buildToolRegistrations({ projectRoot, policy, authorityContextProvider, runtimeContext }) {
  const registrations = [];

  const commandNames = Object.keys(CLI_COMMAND_DEFINITIONS).sort();
  for (const command of commandNames) {
    const classification = classifyForgeLoopInvocation(command);
    if (!toolEnabled(command, classification, policy)) continue;

    const taskAwareMutation = classification.mutatesProtocol && Boolean(CLI_COMMAND_DEFINITIONS[command].options["--task"]);
    const schema = jsonSchemaForCommand(command, { taskAwareMutation });
    const inputSchema = fromJsonSchema(schema);

    registrations.push({
      name: commandToToolName(command),
      config: {
        title: `ForgeLoop: ${command}`,
        description: CLI_COMMAND_DEFINITIONS[command].description,
        inputSchema,
        annotations: annotationsFor(classification, policy),
      },
      riskClass: classification.riskClass,
      handler: async (args) => {
        const startedAt = Date.now();
        // Defense in depth: the catalog excludes disabled tools, but
        // input-dependent escalations (e.g. force:true) are re-checked here.
        const liveClassification = classifyForgeLoopInvocation(command, args ?? {});
        const gate = invocationAllowed(liveClassification, policy);
        if (!gate.allowed) {
          return capabilityRefusalResult({
            code: gate.code,
            requiredCapability: gate.requiredCapability,
            command,
          });
        }
        if (taskAwareMutation && typeof args?.taskId !== "string") {
          return capabilityRefusalResult({ code: "E_MCP_TASK_ID_REQUIRED", requiredCapability: "explicit taskId", command });
        }
        let effectiveArgs = { ...(args ?? {}) };
        // Defense in depth: actor-controlled tool args can never carry host
        // authority, even if a schema or transport leaks the property.
        delete effectiveArgs.authorityContext;
        delete effectiveArgs.runtimeContext;
        try {
          // §3-6: structured input byte bound precedes execution policy.
          effectiveArgs = enforceStructuredInputBound(effectiveArgs);
          effectiveArgs = applyExecutionPolicy({ classification: liveClassification, args: effectiveArgs, policy });
        } catch (error) {
          if (error.code === "E_MCP_INPUT_TOO_LARGE" || error.code === "E_MCP_EXECUTION_TIMEOUT_INVALID"
            || error.code === "E_MCP_EXECUTION_TIMEOUT_EXCEEDS_LIMIT") {
            return capabilityRefusalResult({
              code: error.code,
              requiredCapability: error.code === "E_MCP_INPUT_TOO_LARGE" ? "bounded structured input" : "bounded timeoutMs",
              command,
              messageOverride: error.message,
            });
          }
          throw error;
        }
        void FORGELOOP_INTEGRATION_API_VERSION;
        // Trusted authority is resolved out-of-band by the embedding host,
        // never from tool args (INV-AUTH-03).
        const authorityContext = await authorityContextProvider?.({ command, args: effectiveArgs }) ?? undefined;
        const envelope = await executeForgeLoopCommand({
          command,
          projectPath: projectRoot,
          input: effectiveArgs,
          authorityContext,
          runtimeContext,
        });
        const result = envelopeToToolResult(envelope);
        result._diagnostics = { tool: commandToToolName(command), durationMs: Date.now() - startedAt };
        return result;
      },
    });
  }
  return registrations;
}
