// Short aliases for the types generated from the spec (src/generated/openapi.ts).
// If the spec changes shape, code using these aliases stops compiling.
import type { components } from './generated/openapi';

type Schemas = components['schemas'];
export type Contact = Schemas['Contact'];
export type ContactCreate = Schemas['ContactCreate'];
export type ContactUpdate = Schemas['ContactUpdate'];
export type ContactPage = Schemas['ContactPage'];
export type Message = Schemas['Message'];
export type MessageCreate = Schemas['MessageCreate'];
export type Problem = Schemas['Problem'];
export type FieldError = Schemas['FieldError'];
export type ProblemType = Problem['type'];
