import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDocumentHtml, publicErrorMessage } from '../htmlSecurity.js';
import { getApiKeyPool } from '../apiKeyManager.js';
import { extractLessonTitle } from '../aiService.js';
import { detectSubjectGuidelines } from '../baccalaureateStandards2027.js';
import { createUnansweredQuizHtml, validateInteractiveQuizItems } from '../quizGenerator.js';

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


test('unknown content does not default to a medical track', () => {
  const detected = detectSubjectGuidelines('موضوع عام غير محدد من المصدر فقط');
  assert.equal(/طب|medical/i.test(detected.subjectName), false);
  assert.equal(detected.trackId, 'source_only');
});

test('English lesson detection remains a core subject', () => {
  const detected = detectSubjectGuidelines('English grammar: hedging language and modal verbs');
  assert.equal(detected.trackId, 'core_english');
  assert.equal(/طب|medical/i.test(detected.subjectName), false);
});

test('unanswered essay quiz removes answer key and keeps printable questions', () => {
  const html = '<html><head></head><body><div class="question-card">سؤال مقالي</div><section class="answer-key answer-key-section"><strong>الإجابة النموذجية</strong></section></body></html>';
  const output = createUnansweredQuizHtml(html);
  assert.match(output, /سؤال مقالي/);
  assert.doesNotMatch(output, /الإجابة النموذجية/);
  assert.match(output, /display: none/);
});

test('interactive quiz validator rejects duplicate questions and duplicate options', () => {
  const sourceText = 'القوة المؤثرة على الجسم تساوي الكتلة مضروبة في العجلة وتحدد حركة الجسم';
  const base = {
    options: ['القوة', 'الكتلة', 'العجلة', 'الزمن'],
    correctOptionIndex: 0,
    explanation: 'القوة والعجلة والكتلة من مفاهيم الدرس',
    sourceEvidence: 'القوة المؤثرة على الجسم تساوي الكتلة مضروبة في العجلة',
    cognitiveLevel: 'analysis',
    questionType: 'concept',
    difficulty: 'medium'
  };
  const duplicate = [
    { ...base, question: 'ما العلاقة بين القوة والكتلة والعجلة؟', learningOutcome: 'استنتاج العلاقة الأساسية' },
    { ...base, question: 'ما العلاقة بين القوة والكتلة والعجلة؟', learningOutcome: 'تطبيق القانون' },
    { ...base, question: 'كيف تتغير القوة عند تغير العجلة؟', learningOutcome: 'تحليل أثر التغير' }
  ];
  const result = validateInteractiveQuizItems(duplicate, { count: 3, sourceText });
  assert.equal(result.ok, false);
  assert.match(result.reason, /مكرر/);
});

test('interactive quiz validator rejects repeated answer options', () => {
  const sourceText = 'السرعة تساوي المسافة مقسومة على الزمن وتصف معدل تغير المسافة';
  const items = Array.from({ length: 3 }, (_, index) => ({
    question: `سؤال مختلف رقم ${index + 1} عن السرعة والزمن والمسافة`,
    options: ['نفس الاختيار', 'نفس الاختيار', 'اختيار ثالث', 'اختيار رابع'],
    correctOptionIndex: 0,
    explanation: 'السرعة والمسافة والزمن من مفاهيم المصدر',
    learningOutcome: `ناتج تعلم ${index + 1}`,
    sourceEvidence: 'السرعة تساوي المسافة مقسومة على الزمن',
    cognitiveLevel: index === 0 ? 'application' : 'analysis',
    questionType: 'concept',
    difficulty: 'medium'
  }));
  const result = validateInteractiveQuizItems(items, { count: 3, sourceText });
  assert.equal(result.ok, false);
  assert.match(result.reason, /اختيار/);
});
