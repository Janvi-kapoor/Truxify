import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.resolve(__dirname, '../../src/routes/paymentRoutes.js');

describe('paymentRoutes customer profile declarations', () => {
  it('does not redeclare customerProfile in the payment lock handler', () => {
    const source = fs.readFileSync(routePath, 'utf8');
    const declarations = source.match(/const\s+\{\s*data:\s*customerProfile\s*\}/g) ?? [];

    expect(declarations).toHaveLength(1);
  });
});
