import assert from 'node:assert/strict';
import { processGeneratedHtml } from '../fontsHelper.js';
const input = '<!doctype html><html><head></head><body><div>Download PDF | Question | Answer | Thanawiyah</div></body></html>';
const output = processGeneratedHtml(input);
assert.equal(output.includes('Download PDF'), false);
assert.equal(output.includes('سؤال'), true);
assert.equal(output.includes('إجابة'), true);
assert.equal(output.includes('الثانوية العامة'), true);
console.log('arabic output smoke: ok');
