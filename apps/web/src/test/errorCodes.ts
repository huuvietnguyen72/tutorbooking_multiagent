import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** ErrorCode enum read straight from docs/openapi.yaml so the i18n map cannot drift from the contract. */
const yaml = readFileSync(resolve(__dirname, '../../../../docs/openapi.yaml'), 'utf8');
const match = /ErrorCode:\s*\n\s*type: string\s*\n\s*enum: \[([^\]]+)\]/.exec(yaml);
if (!match) throw new Error('ErrorCode enum not found in openapi.yaml');

export default match[1].split(',').map((s) => s.trim());
