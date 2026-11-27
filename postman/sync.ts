// Keeps the Postman collection in step with openapi/openapi.yaml.
//
//   npm run postman:sync   rewrite the collection's `schemas` variable from the spec
//   npm run postman:check  fail (exit 1) if the collection has drifted from the spec:
//                          stale schemas, or a spec operation with no request
//
// The schemas are fully dereferenced (no $ref) so Postman's jsonSchema() can use them as-is.
import { readFileSync, writeFileSync } from 'node:fs';
import { operations, resolveRef, spec } from '../src/spec';

const COLLECTION = new URL('./contacts-api.postman_collection.json', import.meta.url);
const SCHEMAS = ['Contact', 'ContactPage', 'Message', 'Problem'];

/** Replace every local $ref with the schema it points to. */
function deref(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deref);
  if (node && typeof node === 'object') {
    if ('$ref' in node) return deref(resolveRef(node));
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v)]));
  }
  return node;
}

interface Item {
  name: string;
  item?: Item[];
  request?: { method: string; url: { raw: string } };
}
const collection = JSON.parse(readFileSync(COLLECTION, 'utf8'));

const schemas = JSON.stringify(
  Object.fromEntries(SCHEMAS.map((name) => [name, deref(spec.components.schemas![name])])),
);
const variable = collection.variable.find((v: { key: string }) => v.key === 'schemas');

const problems: string[] = [];
if (variable.value !== schemas) problems.push('the `schemas` variable is out of date with openapi.yaml');

// Every operation in the spec needs at least one request. Compare paths with
// parameters normalized: /contacts/{contactId} and /contacts/{{contactId}} or /contacts/c_1.
const requests: string[] = [];
const walk = (items: Item[]) =>
  items.forEach((i) => {
    if (i.request) requests.push(`${i.request.method} ${i.request.url.raw.replace('{{baseUrl}}', '').split('?')[0]}`);
    walk(i.item ?? []);
  });
walk(collection.item);
for (const op of operations) {
  const pattern = new RegExp(`^${op.method.toUpperCase()} ${op.path.replace(/\{\w+\}/g, '[^/]+')}$`);
  if (!requests.some((r) => pattern.test(r))) {
    problems.push(`no request for ${op.operationId} (${op.method.toUpperCase()} ${op.path})`);
  }
}

if (process.argv.includes('--check')) {
  if (problems.length > 0) {
    console.error(`Postman collection has drifted from the spec:\n  - ${problems.join('\n  - ')}`);
    console.error('Run `npm run postman:sync` for schemas; add requests for new operations by hand.');
    process.exit(1);
  }
  console.log('Postman collection is in sync with the spec.');
} else {
  variable.value = schemas;
  writeFileSync(COLLECTION, `${JSON.stringify(collection, null, 2)}\n`);
  console.log('Updated the schemas variable.', problems.filter((p) => !p.includes('schemas')).join('\n'));
}
