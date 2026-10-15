import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCHEMA_DIR = join(process.cwd(), 'schemas');

export const DEMO_PROJECT_ID = 'forgeshop';
export const DEMO_PROJECT_NAME = 'ForgeShop';

// Single source of truth for artifact → schema mapping (shared with runtime).
const REGISTRY_PATH = join(process.cwd(), 'src', 'main', 'core', 'protocol', 'artifact-registry.json');

export const SCHEMA_FILES = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));

let ajvInstance;
function getAjv() {
  if (!ajvInstance) {
    ajvInstance = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajvInstance);
    for (const file of new Set(Object.values(SCHEMA_FILES))) {
      ajvInstance.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')), file);
    }
  }
  return ajvInstance;
}

export function taskKeyFor(taskId) {
  return createHash('sha256').update(taskId).digest('hex');
}

export function fingerprint(label) {
  return createHash('sha256').update(`${DEMO_PROJECT_ID}:${label}`).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function sha256FileBytes(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function assertSchemaValid(artifactName, value) {
  const schemaFile = SCHEMA_FILES[artifactName];
  if (!schemaFile) throw new Error(`No trusted schema registered for demo artifact "${artifactName}"`);
  const validate = getAjv().getSchema(schemaFile);
  if (!validate) throw new Error(`Trusted schema ${schemaFile} failed to compile`);
  if (!validate(value)) {
    const detail = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join('; ');
    throw new Error(`Demo artifact "${artifactName}" is not schema-valid: ${detail}`);
  }
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
