import { SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

export const RESPONSE_SCHEMA = 'masl:response-schema';

/**
 * Shared zod schema of the handler's response. ResponseSchemaInterceptor parses every response
 * with it, returns the parsed value and marks it `Cache-Control: private, no-store`.
 */
export const ResponseSchema = (schema: ZodType) => SetMetadata(RESPONSE_SCHEMA, schema);
