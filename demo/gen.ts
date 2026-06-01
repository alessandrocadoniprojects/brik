import { generateLevel2Spec } from '../src/qa/level2.js';
import { sampleSpec } from '../src/cli/sampleSpec.js';
import { writeFileSync } from 'node:fs';
const spec = generateLevel2Spec(sampleSpec);
writeFileSync(new URL('./tests/generated.spec.ts', import.meta.url), spec);
console.log(spec);
