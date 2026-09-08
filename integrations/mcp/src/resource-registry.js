import {
  INTEGRATION_RESOURCE_DEFINITIONS,
  readForgeLoopIntegrationResource,
} from "@cassiomc1/forgeloop/integration";
import { ResourceTemplate } from "@modelcontextprotocol/server";

import { stringifyBoundedMcpJson } from "./output-policy.js";

import { logResourceRead } from "./logging.js";

const TASK_RESOURCE_KINDS = [
  "status", "ownership", "contract", "continuity", "workspace-binding", "handoffs",
  "responsibility", "verification-scope", "attestation", "structural-quality", "actions", "approvals", "metrics", "context", "evaluations",
];

/**
 * Deterministic resource catalog from the canonical allowlist. Task-scoped
 * resources are exposed as `forgeloop://task/{taskId}/<kind>` templates; the
 * read path always goes through readForgeLoopIntegrationResource, which
 * derives ownership exclusively from the canonical resolver.
 */
export function registerIntegrationResources(server, { projectRoot, packageRoot }) {
  const readTaskResource = (kind) => async (uri, { taskId }) => {
    const startedAt = Date.now();
    try {
      const resource = await readForgeLoopIntegrationResource(`task/${kind}`, {
        projectPath: projectRoot,
        packageRoot,
        taskId,
      });
      logResourceRead({ uri: resource.uri, durationMs: Date.now() - startedAt, ok: true });
      return { contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: stringifyBoundedMcpJson(resource.data),
      }] };
    } catch (error) {
      logResourceRead({ uri: `task/${kind}`, durationMs: Date.now() - startedAt, ok: false });
      throw error;
    }
  };

  server.registerResource(
    "forgeloop-protocol-info",
    "forgeloop://protocol/info",
    { description: INTEGRATION_RESOURCE_DEFINITIONS["protocol/info"].description },
    async (uri) => {
      const resource = await readForgeLoopIntegrationResource("protocol/info", {
        projectPath: projectRoot,
        packageRoot,
      });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: stringifyBoundedMcpJson(resource.data) }] };
    },
  );

  server.registerResource(
    "forgeloop-project-tasks",
    "forgeloop://project/tasks",
    { description: INTEGRATION_RESOURCE_DEFINITIONS["project/tasks"].description },
    async (uri) => {
      const resource = await readForgeLoopIntegrationResource("project/tasks", {
        projectPath: projectRoot,
        packageRoot,
      });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: stringifyBoundedMcpJson(resource.data) }] };
    },
  );

  for (const kind of TASK_RESOURCE_KINDS) {
    if (!INTEGRATION_RESOURCE_DEFINITIONS[`task/${kind}`]) continue;
    server.registerResource(
      `forgeloop-task-${kind.replaceAll("/", "-")}`,
      new ResourceTemplate(`forgeloop://task/{taskId}/${kind}`, {
        list: undefined,
      }),
      { description: INTEGRATION_RESOURCE_DEFINITIONS[`task/${kind}`].description },
      readTaskResource(kind),
    );
  }
  if (INTEGRATION_RESOURCE_DEFINITIONS["task/action"]) server.registerResource(
    "forgeloop-task-action",
    new ResourceTemplate("forgeloop://task/{taskId}/action/{actionId}", { list: undefined }),
    { description: INTEGRATION_RESOURCE_DEFINITIONS["task/action"].description },
    async (uri, { taskId, actionId }) => {
      const resource = await readForgeLoopIntegrationResource("task/action", { projectPath: projectRoot, packageRoot, taskId, actionId });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: stringifyBoundedMcpJson(resource.data) }] };
    },
  );
  if (INTEGRATION_RESOURCE_DEFINITIONS["project/capability-policy"]) server.registerResource(
    "forgeloop-capability-policy",
    "forgeloop://project/capability-policy",
    { description: INTEGRATION_RESOURCE_DEFINITIONS["project/capability-policy"].description },
    async (uri) => {
      const resource = await readForgeLoopIntegrationResource("project/capability-policy", { projectPath: projectRoot, packageRoot });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: stringifyBoundedMcpJson(resource.data) }] };
    },
  );
  if (INTEGRATION_RESOURCE_DEFINITIONS["repository/index-status"]) server.registerResource(
    "forgeloop-repository-index-status",
    "forgeloop://repository/index-status",
    { description: INTEGRATION_RESOURCE_DEFINITIONS["repository/index-status"].description },
    async (uri) => {
      const resource = await readForgeLoopIntegrationResource("repository/index-status", {
        projectPath: projectRoot,
        packageRoot,
      });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: stringifyBoundedMcpJson(resource.data) }] };
    },
  );
}
