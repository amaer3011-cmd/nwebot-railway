import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDocumentHtml, publicErrorMessage } from '../htmlSecurity.js';
import { getApiKeyPool } from '../apiKeyManager.js';
import { extractLessonTitle } from '../aiService.js';

process.env.GEMINI_API_KEYS = 'first-key, second-key, first-key';
process.env.GEMINI_API_KEY = 'third-key';

test('sanitizeDocumentHtml removes executable content and event handlers', () => {
  const output = sanitizeDocumentHtml('<html><body><script>alert(1)</script><div onclick="alert(2)">درس</div></body></html>');
  assert.equal(output.includes('<script'), false);
  assert.equal(output.includes('onclick'), false);
  assert.match(output, /درس/);
});

test('publicErrorMessage bounds and normalizes user-facing errors', () => {
  assert.equal(publicErrorMessage(new Error('a\nb')), 'a b');
  assert.equal(publicErrorMessage(new Error('x'.repeat(300))), 'تعذر إكمال العملية حالياً. حاول مرة أخرى لاحقاً.');
});

test('getApiKeyPool deduplicates configured keys', () => {
  assert.deepEqual(getApiKeyPool(), ['first-key', 'second-key', 'third-key']);
});

test('extractLessonTitle creates a safe filename title', () => {
  assert.equal(extractLessonTitle('<html><head><title>المتفوق: الحركة/السرعة</title></head></html>'), 'الحركة_السرعة');
});
