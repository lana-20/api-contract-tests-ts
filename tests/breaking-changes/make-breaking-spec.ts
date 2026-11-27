// Writes a deliberately broken copy of the spec, so CI can prove the
// breaking-change gate actually fails when it should (a test for the test).
import { writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { spec } from '../../src/spec';

const broken = structuredClone(spec) as any;

// 1. Remove a response field consumers rely on.
delete broken.components.schemas.ContactPage.properties.nextCursor;
broken.components.schemas.ContactPage.required = ['items'];
// 2. Add a new required request field: existing clients don't send it.
broken.components.schemas.ContactCreate.properties.company = { type: 'string' };
broken.components.schemas.ContactCreate.required.push('company');
// 3. Remove an endpoint.
delete broken.paths['/contacts/{contactId}'].delete;

const out = process.argv[2] ?? 'openapi.breaking.yaml';
writeFileSync(out, stringify(broken));
console.log(`wrote ${out}`);
