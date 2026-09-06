import { GoogleGenerativeAI } from '@google/generative-ai';
import { processGeneratedHtml } from './fontsHelper.js';
import { DESIGN_CATALOG } from './designCatalog.js';
import { detectSubjectGuidelines } from './baccalaureateStandards2027.js';
import { getApiKeyPool } from './apiKeyManager.js';

/**
 * توحيد أخطاء OCR الشائعة في المعادلات قبل عرضها في Telegram أو HTML.
 * لا نستبدل حرف v عشوائياً؛ نعالج فقط الأنماط المعروفة التي يقصد بها الجذر.
 */
function normalizeMathNotation(value) {
  return String(value || '')
    .replace(/\bX{4,}\b/g, '')
    .replace(/\[رمز\]/g, '')
    .replace(/\\lambda\s*(?:sqrt|\\sqrt)\s*/gi, '\\sqrt')
    .replace(/\\lambda\s*(?:frac|\\frac)\s*/gi, '\\frac')
    .replace(/\\Stheta/gi, '\\theta')
    .replace(/\b(?:Sis|SS)\s*(?=\\(?:sqrt|frac|vec|hat))/g, '')
    .replace(/v\s*\(\s*2\s*\(([^()]+)\)\s*\)/g, '\\sqrt{2($1)}')
    .replace(/v\s*\(\s*2\s*([a-zA-Z])\s*([a-zA-Z])\s*\)/g, '\\sqrt{2$1$2}')
    .replace(/\bt\s*=\s*v\s*\(\s*2\s*([^()]+)\s*\/\s*([^()]+)\s*\)/g, 't = \\sqrt{\\frac{2$1}{$2}}')
    .replace(/\bi\s*=\s*0?55\s*\)/g, 'i = 0.55')
    .replace(/\b(\d+(?:\.\d+)?)\s*text\s*([a-zA-Z/²³]+)/gi, '$1 \\mathrm{$2}');
}

function normalizeQuizItem(item) {
  return {
    ...item,
    question: normalizeMathNotation(item.question).trim(),
    options: (item.options || []).map(option => normalizeMathNotation(option).trim()),
    explanation: normalizeMathNotation(item.explanation || '').trim(),
    learningOutcome: normalizeMathNotation(item.learningOutcome || '').trim()
  };
}

function normalizeEvidenceText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasSourceEvidence(item, sourceText) {
  const evidence = normalizeEvidenceText(item?.sourceEvidence);
  const source = normalizeEvidenceText(sourceText);
  return evidence.length >= 8 && source.includes(evidence);
}

function sourceKeywords(sourceText) {
  const stopWords = new Set(['من', 'في', 'على', 'إلى', 'عن', 'هذا', 'هذه', 'ذلك', 'تلك', 'هو', 'هي', 'ثم', 'أو', 'أي', 'كل', 'إذا', 'مع', 'كما', 'بين', 'عند', 'حيث', 'يتم', 'يمكن', 'يكون', 'كان', 'كانت', 'the', 'and', 'for', 'with']);
  return [...new Set(normalizeEvidenceText(sourceText)
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(word => word.length >= 4 && !stopWords.has(word)))];
}

function matchesSourceConcepts(item, sourceText) {
  const keywords = sourceKeywords(sourceText);
  if (keywords.length < 2) return true;
  const questionText = normalizeEvidenceText([
    item?.question,
    ...(Array.isArray(item?.options) ? item.options : []),
    item?.explanation
  ].join(' '));
  const overlap = keywords.filter(keyword => questionText.includes(keyword));
  return new Set(overlap).size >= Math.min(2, keywords.length);
}

function hasCognitiveQuality(items, count) {
  const levels = items.map(item => String(item?.cognitiveLevel || '').toLowerCase());
  const higher = levels.filter(level => level === 'analysis' || level === 'inference').length;
  const application = levels.filter(level => level === 'application').length;
  const outcomes = new Set(items.map(item => normalizeEvidenceText(item?.learningOutcome)).filter(Boolean));
  const questions = items.map(item => normalizeEvidenceText(item?.question));
  return levels.every(level => ['understanding', 'application', 'analysis', 'inference'].includes(level)) &&
    higher >= Math.ceil(count * 0.4) &&
    application >= Math.max(1, Math.floor(count * 0.2)) &&
    outcomes.size >= Math.min(3, count) &&
    new Set(questions).size === questions.length;
}

/**
 * مولّد الكويزات الاحترافي لبوت «المتفوق»
 * يدعم:
 * - كويز اختيار من متعدد (Telegram Quiz Poll)
 * - كويز صح / غلط
 * - كويز أكمل العبارة
 * - بنك أسئلة تفكير عليا للثانوية العامة 2027
 */

function getQuizApiKeyPool(apiKey) {
  return getApiKeyPool(apiKey);
}

/**
 * توليد كويز اختيار من متعدد (MCQ) لاستخدامه كـ Telegram Quiz Poll
 */
export async function generateInteractiveQuiz({
  apiKey,
  contentText,
  modelName = 'gemini-3.6-flash',
  count = 5,
  difficulty = 'mixed',
  quizType = 'mcq',
  explicitTrack = null
}) {
  if (!apiKey) throw new Error('مفتاح API غير متوفر');

  const keyPool = getQuizApiKeyPool(apiKey);
  // نبدأ بالنماذج الأكثر استقراراً، ونترك النموذج المطلوب كخيار أخير.
  const modelsToTry = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.6-flash', modelName];
  const uniqueModels = [...new Set(modelsToTry.filter(Boolean))];
  let lastError = null;

  const difficultyMap = {
    easy: 'مستوى الفهم والتذكر البسيط (30%)',
    medium: 'مستوى التطبيق والتوظيف المباشر (40%)',
    hard: 'مستوى التفكير النقدي والاستنتاج وحل المشكلات (30%)',
    mixed: 'توزيع متوازن بحسب معايير البكالوريا 2027 (30% فهم، 40% تطبيق، 30% تفكير عليا)'
  };

  const typePromptMap = {
    mcq: 'اختيار من متعدد (4 خيارات واضحة مع إجابة صحيحة واحدة وثلاث مشتتات ذكية)',
    truefalse: 'صواب أو خطأ مع التعليل العلمي الدقيق',
    mixed: 'تنوع بين الاختيار من متعدد وصواب أو خطأ'
  };

  for (let keyIndex = 0; keyIndex < keyPool.length; keyIndex++) {
    const currentApiKey = keyPool[keyIndex];
    const genAI = new GoogleGenerativeAI(currentApiKey);

    for (const currentModel of uniqueModels) {
      try {
        console.log(`🧠 توليد كويز (${count} سؤال) بالمفتاح [${keyIndex + 1}/${keyPool.length}] نموذج: ${currentModel}...`);
        const model = genAI.getGenerativeModel({
          model: currentModel,
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json"
          }
        });

        const subjectInfo = detectSubjectGuidelines(contentText, explicitTrack);

    const prompt = `
أنت خبير تربوي متخصص في إنشاء كويزات من **الدرس المصدر المرفق فقط**.
⚠️ قاعدة أولوية مطلقة: لا تنشئ أي سؤال من معلومات عامة أو من مادة أخرى. كل سؤال وكل إجابة وتفسير يجب أن يكون قابلاً للإسناد إلى النص المرجعي أدناه.
⚠️ إذا كان النص درس فيزياء، فكل الأسئلة فيزياء فقط؛ ممنوع أسئلة النحو أو البلاغة أو التاريخ أو الأحياء أو أي مادة لا تظهر في النص.
⚠️ لا تستخدم مواصفات المنهج أو الإرشادات العامة أعلاه كمصدر للسؤال؛ المصدر الوحيد هو النص الموجود تحت عنوان «المحتوى العلمي المرجعي الوحيد المسموح باستخدامه». يجب أن تكون الإجابة قابلة للاستخراج أو الاستنتاج المباشر من هذا النص.
📌 التخصص والمادة المستهدفة: **${subjectInfo.subjectName}** (${subjectInfo.trackTitle})

المطلوب: قم بإنشاء ${count} سؤال بنمط: ${typePromptMap[quizType] || typePromptMap.mcq}

مستوى الصعوبة والتوزيع: ${difficultyMap[difficulty] || difficultyMap.mixed}

🧠 **التوزيع المعرفي الإلزامي (لا تقبل أسئلة حفظ سطحية فقط):**
- 20% فهم المفهوم: تفسير معنى أو تمييز علاقة من النص.
- 40% تطبيق: تعويض أو اختيار القانون المناسب في موقف جديد.
- 40% تحليل واستنتاج: مقارنة حالتين، اكتشاف نتيجة، تفسير سبب، أو استنتاج علاقة غير مكتوبة حرفياً مع الاعتماد على المصدر.
- يجب أن تتنوع نواتج التعلم، وألا تتكرر الفكرة أو طريقة الحل، وأن تتضمن المشتتات أخطاء مفاهيمية معقولة لا إجابات عشوائية.

🎓 مواصفات ومعايير أسئلة البكالوريا 2027 التخصصية لمادة (${subjectInfo.subjectName}):
${subjectInfo.guidelines}

📊 التوزيع المعرفي الإلزامي للأسئلة:
- ${subjectInfo.cognitiveDistribution.understanding}
- ${subjectInfo.cognitiveDistribution.application}
- ${subjectInfo.cognitiveDistribution.higherThinking}

⚖️ المبادئ الفنية الصارمة:
${subjectInfo.generalPrinciples.map(p => `• ${p}`).join('\n')}

🧮 **قواعد إلزامية للرياضيات والفيزياء:**
- استخدم LaTeX القياسي فقط داخل النص: \\\\sqrt{...} للجذر، وv_i وv_f وa_x للرموز السفلية.
- ممنوع استخدام الحرف v بديلاً عن الجذر، وممنوع كتابة text أو أقواس زائدة داخل المعادلة.
- اكتب الوحدات بصيغة \\\\mathrm{m/s} أو \\\\mathrm{m/s^2}، وتحقق من كل رقم وإشارة قبل الإخراج.
- إذا كانت المادة رياضيات، استخدم الرموز العربية الرسمية فقط: س، ص، ت، ع، جا، جتا، ظا، حـ، ىـ، وأ، ب، م، مثل ع = س + ص ت و ف = \\\\sqrt{(س_2 - س_1)^2 + (ص_2 - ص_1)^2}.
- إذا كانت المادة فيزياء، أبقِ الرموز الإنجليزية القياسية مثل x وy وz وv_i وv_f وa_x وa_y ولا تعرّبها.
- في معادلات الحركة استخدم علامة الجمع + الصحيحة، ولا تستخدم \\\\div بين الحدود. استخدم الصيغ: v_f = v_i + a t، وd = v_i t + \\\\frac{1}{2} a t^2، وv_f^2 = v_i^2 + 2 a d.
- إذا ظهرت معادلة مشوهة مثل u_f=\\sqrt{}\\{2gd) أو d=%gt I t=V(2d/g)، أعد كتابتها كاملة بـ LaTeX صحيح ولا تنقلها كما هي.
- ممنوع منعاً باتاً استخدام \\lambda أو S أو SS أو Sis أو \\Stheta قبل أو بعد القوانين. استخدم فقط \\sqrt{...} و\\frac{a}{b} و\\vec{A} و\\hat{i} و\\hat{j}، مع فصل النص العربي عن المعادلة بمسافات واضحة.

📊 **قواعد الجداول:**
- إذا احتاج السؤال أو التفسير جدولاً، أخرجه كـ Markdown Table صحيح بأعمدة ثابتة: العنوان | نوع الحركة | القيمة | العلاقة.
- افصل الرموز والمعادلات عن النص العربي داخل الخلايا، ولا تخلط RTL/LTR في خلية واحدة دون مسافات واضحة.
- عند مقارنة الحركة الأفقية والرأسية استخدم الأعمدة: وجه المقارنة | الحركة الأفقية (Horizontal Axis - X) | الحركة الرأسية (Vertical Axis - Y)، مع رموز منفصلة مثل v_x وa_x وv_y وg.

🗣️ **الشرح الودود:**
- عند شرح مفهوم فيزيائي، ابدأ بسطر مستقل بعنوان «الفكرة ببساطة (بالعامية المصرية)» وبمثال يومي مشجع من سطرين أو ثلاثة.

📝 **تنسيق أسئلة الاختيار من متعدد:**
- يجب أن يكون كل خيار في عنصر مستقل داخل مصفوفة options؛ لا تدمج خيارين في نص واحد ولا تستخدم مسافات أفقية للفصل.
- عند عرض الخيارات خارج JSON، استخدم سطوراً مستقلة بالترتيب: (أ) ثم (ب) ثم (ج) ثم (د).
- أضف لكل سؤال الحقل sourceEvidence، وهو اقتباس حرفي من 8 إلى 20 كلمة متتالية من النص المرجعي يثبت مصدر السؤال. ممنوع إعادة صياغة الاقتباس أو اختراع اقتباس غير موجود.

🔢 **ضبط المعطيات والوحدات:**
- أي مسألة أو تدريب مقالي يجب أن يحتوي على قيم عددية صريحة للارتفاع والسرعة والزمن وغيرها عند الحاجة؛ لا تترك قيمة فارغة أو صفراً دون قصد.
- اكتب الرقم ووحدته مرة واحدة فقط وبمسافة واحدة، مثل 80 m أو 80 متر، ولا تكرر الوحدة أو الرقم.
- ممنوع دمج رقمين بمسافة عادية مثل 4 5؛ استخدم الرقم الصحيح مثل 4.5 s. اكتب السرعات كاملة مع وحداتها مثل 10 m/s و30 m/s.
- ممنوع استخدام XXXXX أو XXXX أو [رمز] أو أي حرف تعويضي بدلاً من قانون أو قيمة؛ اكتب القوانين كاملة، مثل (مساحة الأول / مساحة الثاني) = k^2.
- استخدم \\\\sqrt{...} دائماً للجذور، ولا تستخدم حرف v بديلاً عنه، واكتب مسافة واحدة فقط بين الرقم والوحدة.

✅ **مفتاح الإجابات:**
- افصل النتيجة النهائية بخط مستقل وبخط عريض عن التعليل.
- اكتب خطوات الحل أو التعليل في أسطر نقطية مستقلة، مع الحفاظ على LaTeX مثل t = \\\\sqrt{\\\\frac{2y}{g}}.

يجب أن ينتهي المخرج كـ JSON Array يتبع هذا التنسيق بالضبط:
[
  {
    "question": "نص السؤال هنا",
    "options": ${quizType === 'truefalse' ? '["صح ✅", "غلط ❌"]' : '["اختيار 1", "اختيار 2", "اختيار 3", "اختيار 4"]'},
    "correctOptionIndex": 0,
    "explanation": "شرح موجز ودقيق لسبب صحة هذا الخيار وناتج التعلم المستهدف",
    "learningOutcome": "ناتج التعلم المستهدف (مثل: استنتاج علاقة / تطبيق قانون عكسي / تحليل دلالة)",
    "sourceEvidence": "اقتباس حرفي قصير من النص المرجعي",
    "cognitiveLevel": "understanding|application|analysis|inference",
    "questionType": "concept|calculation|comparison|prediction|diagnosis",
    "difficulty": "easy|medium|hard"
  }
]

المحتوى العلمي المرجعي الوحيد المسموح باستخدامه:
${contentText.slice(0, 12000)}
`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const quizItems = JSON.parse(text);

        if (Array.isArray(quizItems) && quizItems.length > 0) {
          const validItems = quizItems.filter(item =>
            item && typeof item.question === 'string' && item.question.trim().length >= 10 &&
            Array.isArray(item.options) && item.options.length >= 2 &&
            item.options.every(opt => typeof opt === 'string' && opt.trim().length > 0) &&
            Number.isInteger(Number(item.correctOptionIndex)) &&
            Number(item.correctOptionIndex) >= 0 && Number(item.correctOptionIndex) < item.options.length &&
            hasSourceEvidence(item, contentText) &&
            matchesSourceConcepts(item, contentText)
          );

          if (validItems.length < count) {
            throw new Error('النموذج أرجع أسئلة خارج الموضوع أو بدون اقتباس مصدر حرفي صالح');
          }
          if (!hasCognitiveQuality(validItems.slice(0, count), count)) {
            throw new Error('النموذج أرجع كويزاً سطحياً أو مكرراً ولا يحقق توزيع الفهم والتطبيق والتحليل');
          }

          return validItems.slice(0, count).map(item => ({
            ...normalizeQuizItem(item),
            question: normalizeQuizItem(item).question.slice(0, 500),
            options: normalizeQuizItem(item).options.slice(0, 4).map(opt => String(opt).slice(0, 180)),
            correctOptionIndex: Math.min(Number(item.correctOptionIndex), Math.min(item.options.length, 4) - 1),
            explanation: item.explanation ? normalizeMathNotation(String(item.explanation)).trim().slice(0, 400) : 'الإجابة مستندة إلى القاعدة أو المثال الوارد في الدرس.',
            learningOutcome: item.learningOutcome ? String(item.learningOutcome).trim().slice(0, 140) : 'تطبيق ناتج تعلم من الدرس المصدر',
            sourceEvidence: String(item.sourceEvidence || '').trim().slice(0, 220),
            cognitiveLevel: ['understanding', 'application', 'analysis', 'inference'].includes(String(item.cognitiveLevel).toLowerCase()) ? String(item.cognitiveLevel).toLowerCase() : 'application',
            questionType: String(item.questionType || 'concept').trim().slice(0, 40),
            difficulty: ['easy', 'medium', 'hard'].includes(item.difficulty) ? item.difficulty : 'mixed'
          }));
        }
      } catch (err) {
        const message = String(err?.message || '');
        const statusMatch = message.match(/\b(429|503)\b/);
        const status = err?.status || (statusMatch ? Number(statusMatch[1]) : null);
        if (status === 503) {
          console.warn(`النموذج ${currentModel} مزدحم مؤقتاً (503)، سيتم الانتقال إلى fallback التالي.`);
        } else if (status === 429) {
          console.warn(`تم تجاوز حصة النموذج ${currentModel} لهذا المفتاح (429)، سيتم الانتقال إلى نموذج/مفتاح آخر.`);
        } else {
          console.warn(`فشلت محاولة الكويز بالمفتاح [${keyIndex + 1}/${keyPool.length}] نموذج ${currentModel}:`, message);
        }
        lastError = err;
      }
    }
  }

  throw new Error(`تعذر توليد الكويز: ${lastError?.message || 'غير معروف'}`);
}

/**
 * توليد كويز بصيغة HTML احترافية (ملف PDF) بنفس تصميم «المتفوق»
 */
export async function generateQuizPdf({
  apiKey,
  contentText,
  modelName = 'gemini-3.6-flash',
  count = 10,
  selectedIdentity = '🎀 الورقة الملونة',
  isPartner = true,
  difficulty = 'mixed',
  lessonTitle = 'كويز المتفوق',
  explicitTrack = null
}) {
  if (!apiKey) throw new Error('مفتاح API غير متوفر');

  const keyPool = getQuizApiKeyPool(apiKey);
  const modelsToTry = [modelName, 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.6-flash'];
  const uniqueModels = [...new Set(modelsToTry.filter(Boolean))];
  let lastError = null;

  const difficultyMap = {
    easy: 'سهلة',
    medium: 'متوسطة',
    hard: 'صعبة — تفكير عليا',
    mixed: 'متنوعة المستويات'
  };

  for (let keyIndex = 0; keyIndex < keyPool.length; keyIndex++) {
    const currentApiKey = keyPool[keyIndex];
    const genAI = new GoogleGenerativeAI(currentApiKey);

    for (const currentModel of uniqueModels) {
      try {
        console.log(`📋 توليد كويز PDF (${count} سؤال) بالمفتاح [${keyIndex + 1}/${keyPool.length}] نموذج: ${currentModel}...`);
        const model = genAI.getGenerativeModel({
          model: currentModel,
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 16384,
          }
        });

        const customCss = DESIGN_CATALOG[selectedIdentity] || DESIGN_CATALOG['🎀 الورقة الملونة'];
        const subjectInfo = detectSubjectGuidelines(contentText, explicitTrack);

        const prompt = `
أنت مصمم جرافيك ومدرس أول ومستشار مادة محترف خبير في إنشاء كويزات احترافية لسلسلة «المتفوق» المخصصة حصرياً لنظام «البكالوريا المصرية 2027» بمساراتها الأربعة.
📌 المادة والتخصص: **${subjectInfo.subjectName}** (${subjectInfo.trackTitle})

⚠️ **عزل المصدر إلزامي:** أنشئ كل سؤال وكل اختيار وكل حل من المحتوى العلمي المرجعي الموجود في نهاية التعليمات فقط. ممنوع إضافة معلومات عامة أو قوانين أو أمثلة غير موجودة في المصدر، وإذا لم يكفِ المصدر لعدد الأسئلة فأنشئ أسئلة أقل مرتبطة بالمصدر ولا تملأ العدد بالتخمين.

⚠️ **حظر هام:** مخرجك يجب أن يكون **كود HTML نقي** يبدأ فوراً بـ \`<!DOCTYPE html>\` وينتهي بـ \`</html>\` بدون أي نص خارجي.

المطلوب: تصميم **كويز احترافي مطبوع** يحتوي على ${count} سؤالاً بصيغة HTML/A4 جاهزة للطباعة كـ PDF وفق معايير البكالوريا 2027، ومقسّم إلى جزأين واضحين: MCQs ثم أسئلة مقالية وتحليلية.

📌 مواصفات الكويز:
- **عنوان الكويز:** كويز المتفوق — ${lessonTitle}
- **المسار والمادة:** ${subjectInfo.subjectName} (${subjectInfo.trackTitle})
- **عدد الأسئلة:** ${count} سؤال
- **مستوى الصعوبة:** ${difficultyMap[difficulty] || difficultyMap.mixed}
- **الهوية البصرية:** ${selectedIdentity}
- **شراكة بوت Thanawiyah 🎓:** ${isPartner ? 'مفعّلة (إدراج شريط الشراكة أعلى الغلاف والعلامة المائية الشفافة)' : 'معطّلة'}

🎓 مواصفات ومعايير أسئلة البكالوريا لمادة (${subjectInfo.subjectName}):
${subjectInfo.guidelines}

📊 التوزيع المعرفي:
• ${subjectInfo.cognitiveDistribution.understanding}
• ${subjectInfo.cognitiveDistribution.application}
• ${subjectInfo.cognitiveDistribution.higherThinking}

🧠 **جودة الأسئلة إلزامية:** لا تجعل الكويز حفظاً مباشراً فقط. وزّع الأسئلة بين فهم المفهوم، التطبيق، والتحليل والاستنتاج؛ اجعل 40% على الأقل تطبيقاً أو تحليلاً، و40% على الأقل تحليلاً أو استنتاجاً، مع ناتج تعلم مختلف لكل سؤال ومشتتات مفاهيمية معقولة.

استخدم نظام الـ CSS التالي داخل وسم <style>:
\`\`\`css
${customCss}
\`\`\`

📐 تصميم الكويز:
0. **الهرمية البصرية والخطوط:** استخدم Noto Sans Arabic للنصوص العربية، وPoppins للنصوص الإنجليزية والأرقام اللاتينية، وCairo للعناوين، وLalezar للشارات القصيرة فقط. لا تستخدم الخط المزخرف في الفقرات الطويلة.
0. **قابلية القراءة:** حجم النص الأساسي بين 11 و12.5pt، العناوين بين 16 و24pt، line-height بين 1.6 و1.85، ومسافة واضحة بين السؤال والاختيارات ومفتاح الإجابة.
0. **التنظيم الطباعي:** لا تضع أكثر من سؤالين متوسطين في صفحة واحدة إذا احتاج كل منهما شرحاً أو مساحة حل؛ امنع انقسام بطاقة السؤال أو جدولها بين صفحتين، واجعل الهوامش متوازنة والعناصر مصطفة على شبكة واحدة.
1. **صفحة الغلاف:** شريط الشراكة + هيدر مع عنوان الكويز + الشعار + عدد الأسئلة والتعليمات
2. **الجزء الأول — أسئلة الاختيار من متعدد (MCQs):** كل سؤال مرقم بوضوح مع 4 اختيارات في أربعة أسطر مستقلة بالترتيب (أ)، (ب)، (ج)، (د)، مع دوائر أو مربعات اختيار فارغة ☐. ممنوع دمج الاختيارات في سطر واحد أو فصلها بمسافات أفقية، ويجب أن تحتوي القيم على وحداتها.
3. **الجزء الثاني — الأسئلة المقالية والتحليلية:** اذكر المعطيات والمطلوب والوحدات بوضوح، ثم أضف بعد كل سؤال مساحة بعنوان «مساحة خطتك وحلك باليد (فكر وحل هنا أولاً):» مع 3–5 أسطر مخصصة للحل.
4. **مساحة «حل بإيدك»:** استخدم مساحة مخططة كلاس \`.workspace-area\` بعد كل سؤال مقالي، واضبط عدد الأسئلة حتى لا يحدث تزاحم أو قص في الصفحة.
5. **مفتاح الإجابات:** في نهاية الكويز تحت عنوان «مفتاح الإجابات النموذجية والتعليلات العلمية»، افصل كل إجابة في بطاقة مستقلة.
5. **الفوتر:** «ولا تنسوا الصلاة على النبي ﷺ» + «نجتهد لنوفق 🌟» + @A7med19_7

🧮 **تنسيق المعادلات والرموز — إلزامي:**
- استخدم KaTeX بصيغة \\\\(...\\) داخل السطر و\\\\[...\\] للمعادلة المنفصلة.
- اكتب الجذر دائماً \\\\sqrt{...} بدون مسافات زائدة، ولا تستخدم v أو V أو \\\\lambda كبديل للجذر، ولا تكتب صيغة مثل \\\\sqrt{}(2\\times500/10).
- استخدم LaTeX القياسي فقط للكسور والمتجهات: \\\\frac{a}{b} و\\\\vec{A} و\\\\hat{i} و\\\\hat{j}. ممنوع ظهور S أو SS أو Sis أو \\\\Stheta قبل أو بعد القوانين.
- راجع الرموز السفلية مثل v_i وv_f وv_x وv_y وa_x وa_y والوحدات مثل \\\\mathrm{m/s}.
- راجع OCR والأرقام حرفياً: لا تستبدل 4.5 بـ (4)^2، ولا تغيّر أي رقم وارد في رأس المسألة.
- بعد كل رقم في نص المسألة اكتب مسافة صريحة ثم الوحدة، مثل 4.5 \\\\mathrm{s} أو 500 \\\\mathrm{m}، ولا تلصق الرقم بالكلمة التالية.
- في معادلات الحركة استخدم + ولا تستخدم \\\\div بين الحدود. الصيغ المرجعية: v_f = v_i + a t، وd = v_i t + \\\\frac{1}{2} a t^2، وv_f^2 = v_i^2 + 2 a d.
- لا تنقل معادلات OCR المشوهة مثل u_f=\\sqrt{}\\{2gd) أو d=%gt I t=V(2d/g)؛ أعد بناءها بصيغة LaTeX كاملة.
- ممنوع دمج رقمين بمسافة مثل 4 5؛ استخدم 4.5 \\\\mathrm{s}. اكتب السرعات كاملة مثل 10 \\\\mathrm{m/s} و30 \\\\mathrm{m/s}.
- إذا كانت المادة رياضيات، استخدم الرموز العربية الرسمية س، ص، ت، ع، جا، جتا، ظا، حـ، ىـ، وأ، ب، م، ولا تستخدم x أو y أو z أو i في القوانين.
- إذا كانت المادة فيزياء، استخدم الرموز الإنجليزية القياسية كما هي، مثل x وy وv_i وv_f وa_x وa_y.

📊 **الجداول — إلزامي:**
- أنشئ الجداول بعنصر HTML `<table>` حقيقي، مع صف رأس واضح وأعمدة منفصلة: العنوان، نوع الحركة، القيمة، العلاقة.
- امنع تداخل RTL/LTR: ضع كل معادلة داخل وسم span باتجاه ltr وبكلاس math، مع مسافات واضحة قبلها وبعدها.
- عند مقارنة الحركة الأفقية والرأسية استخدم ثلاثة أعمدة: وجه المقارنة | الحركة الأفقية (Horizontal Axis - X) | الحركة الرأسية (Vertical Axis - Y)، وصفوف طبيعة السرعة والعجلة والإزاحة والسرعة.
- استخدم صيغاً منفصلة مثل v_x = v_i وa_x = 0 وv_y = g \\cdot t = \\\\sqrt{2g y}.
- اترك مسافة رأسية واضحة بين المعادلة وما يليها داخل كل كارت أو جدول، ولا تجعل إطار الجدول يلامس المعادلة.

🗣️ **شرح مبسط — إلزامي قبل الشرح الأكاديمي:**
- أضف بطاقة بعنوان «الفكرة ببساطة (بالعامية المصرية)» من 2–3 أسطر وبمثال يومي مشجع.

📝 **مفتاح الإجابات — إلزامي:**
- لكل سؤال بطاقة مستقلة داخل .answer-key.
- اكتب رقم السؤال وتصنيفه، ثم في سطر مستقل الإجابة النهائية بخط <strong>، ثم خطوات الحل في قائمة <ul><li>...</li></ul>.
- لا تضع الإجابات كلها في سطر واحد ولا تخلط الإجابة مع نص السؤال.
- في MCQ اعرض الاختيار الصحيح بصيغة (أ) أو (ب) أو (ج) أو (د) في سطر مستقل، واجعل كل خطوة تعليل في نقطة مستقلة.
- اجعل كل سؤال في فقرة مستقلة تبدأ بنص السؤال، ثم (أ) و(ب) و(ج) و(د) كل واحد في سطر مستقل، ولا تستخدم مسافات أفقية للفصل.
- لا تطبع خيارات MCQ أفقياً أبداً؛ اطبع (أ)، (ب)، (ج)، (د) في أربعة أسطر منفصلة.
- ابدأ كل إجابة بفقرة مستقلة بصيغة «إجابة س[الرقم]: [رمز الخيار] - [النتيجة]»، ثم ضع «التعليل/الخطوات» في سطر مستقل.
- إجابة السؤال المقالي يجب أن تحتوي على «المعطيات والخطوات» ثم «الناتج النهائي» بالرقم والوحدة وبخط بارز.
- طابق كل رقم ورمز ووحدة في مفتاح الإجابات مع رأس السؤال قبل إخراج HTML، ولا تغيّر أي معطى أثناء الحل.

⚠️ الدقة العلمية 100%: تأكد من صحة كل سؤال وصحة الخيار المعلم كإجابة صحيحة قبل الإخراج بدون أي التباس.

📄 القواعد التقنية:
- كل صفحة بحاوية: \`<div class="pg">\` ... \`</div>\` بأبعاد \`210mm x 296mm\`
- \`break-after: page;\` لكل صفحة
- الخطوط: Google Fonts (Noto Sans Arabic, Tajawal, Cairo, Poppins, Lalezar, Aref Ruqaa)
- اتجاه RTL

المحتوى العلمي المرجعي لإنشاء الأسئلة:
${contentText.slice(0, 12000)}
`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        if (responseText && responseText.length > 100) {
          return processGeneratedHtml(responseText);
        }
      } catch (err) {
        console.warn(`فشلت محاولة كويز PDF بالمفتاح [${keyIndex + 1}/${keyPool.length}]:`, err.message);
        lastError = err;
      }
    }
  }

  throw new Error(`تعذر توليد كويز PDF: ${lastError?.message || 'غير معروف'}`);
}

/**
 * توليد كويز ويب تفاعلي ذاتي التصحيح (Self-Grading HTML Quiz)
 * يعمل بدون إنترنت على أي متصفح (موبايل أو كمبيوتر) ويحسب النتيجة فوراً مع الشرح والتحليل
 */
export async function generateSelfGradingHtmlQuiz({
  apiKey,
  contentText,
  modelName = 'gemini-3.6-flash',
  count = 10,
  difficulty = 'mixed',
  quizType = 'mcq',
  lessonTitle = 'كويز تفاعلي',
  isPartner = true,
  explicitTrack = null
}) {
  const subjectInfo = detectSubjectGuidelines(contentText, explicitTrack);

  // 1. استخراج الأسئلة بنظام JSON
  const questions = await generateInteractiveQuiz({
    apiKey,
    contentText,
    modelName,
    count,
    difficulty,
    quizType,
    explicitTrack
  });

  if (!questions || questions.length === 0) {
    throw new Error('لم يتم توليد أي أسئلة صالحة للكويز التفاعلي');
  }

  const safeTitle = lessonTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeSubject = subjectInfo.subjectName;
  const questionsJson = JSON.stringify(questions);

  const htmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>كويز تفاعلي ذاتي التصحيح — ${safeTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&family=Lalezar&family=Noto+Sans+Arabic:wght@400;500;600;700;800&family=Poppins:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
  <style>
    :root {
      --primary: #178F94;
      --secondary: #EC275F;
      --accent: #F7941D;
      --dark: #2B3445;
      --bg: #F3F6C3;
      --paper: #FCFCF9;
      --card-bg: #FFFFFF;
      --correct: #10B981;
      --wrong: #EF4444;
      --border-color: #E2E8F0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Noto Sans Arabic', 'Cairo', sans-serif; }
    body {
      background: var(--bg);
      color: var(--dark);
      padding: 28px 14px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .quiz-container {
      width: 100%;
      max-width: 860px;
      background: var(--paper);
      border: 3.5px solid var(--primary);
      border-radius: 20px;
      padding: 30px clamp(18px, 4vw, 42px);
      box-shadow: 0 15px 35px rgba(0,0,0,0.1);
      position: relative;
    }
    .partner-header {
      background: linear-gradient(90deg, var(--dark), #1D2636);
      color: #FFF;
      border-radius: 10px;
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      font-size: 0.86rem;
      line-height: 1.65;
      border: 1.5px solid #FFE938;
    }
    .quiz-head {
      text-align: center;
      border-bottom: 2.5px dashed var(--primary);
      padding-bottom: 18px;
      margin-bottom: 20px;
    }
    .quiz-badge {
      display: inline-block;
      background: var(--secondary);
      color: #FFF;
      font-family: 'Lalezar', cursive;
      font-size: 1.6rem;
      padding: 4px 22px;
      border-radius: 12px;
      box-shadow: 3px 3px 0 var(--dark);
      transform: rotate(-1deg);
      margin-bottom: 10px;
    }
    .quiz-title {
      font-size: clamp(1.2rem, 2.5vw, 1.55rem);
      font-weight: 800;
      line-height: 1.55;
      color: var(--dark);
    }
    .quiz-meta-bar {
      background: #E9F7F5;
      border-right: 5px solid var(--primary);
      border-radius: 10px;
      padding: 12px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 25px;
      font-size: 0.95rem;
      font-weight: 700;
    }
    .timer-badge {
      background: var(--dark);
      color: #FFF;
      padding: 4px 14px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 800;
      font-family: monospace;
      font-size: 1.1rem;
    }
    .progress-bar-wrap {
      width: 100%;
      height: 10px;
      background: #E2E8F0;
      border-radius: 10px;
      margin-bottom: 25px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--secondary));
      width: 0%;
      transition: width 0.3s ease;
    }
    .q-card {
      background: var(--card-bg);
      border: 2px solid var(--border-color);
      border-radius: 14px;
      padding: 22px 24px;
      margin-bottom: 24px;
      transition: all 0.25s ease;
      box-shadow: 0 4px 10px rgba(0,0,0,0.03);
    }
    .q-card.correct-ans {
      border-color: var(--correct);
      background: #F0FDF4;
    }
    .q-card.wrong-ans {
      border-color: var(--wrong);
      background: #FEF2F2;
    }
    .q-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;
    }
    .q-num {
      background: var(--primary);
      color: #FFF;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Lalezar', cursive;
      font-size: 1.1rem;
      flex-shrink: 0;
    }
    .q-text {
      font-size: 1.08rem;
      font-weight: 700;
      line-height: 1.8;
      color: var(--dark);
    }
    .math, .katex { direction: ltr; unicode-bidi: embed; }
    .katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
    .explanation-box ul { margin: 8px 22px 0 0; }
    .q-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .opt-label {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border: 1.5px solid var(--border-color);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      background: #FFF;
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.7;
    }
    .opt-label:hover {
      border-color: var(--primary);
      background: #F8FAFC;
    }
    .opt-label input[type="radio"] {
      width: 18px;
      height: 18px;
      accent-color: var(--secondary);
      cursor: pointer;
    }
    .opt-label.selected {
      border-color: var(--secondary);
      background: #FFF5F7;
    }
    .opt-label.ans-correct {
      border-color: var(--correct) !important;
      background: #DCFCE7 !important;
      color: #065F46 !important;
      font-weight: 800;
    }
    .opt-label.ans-wrong {
      border-color: var(--wrong) !important;
      background: #FEE2E2 !important;
      color: #991B1B !important;
      text-decoration: line-through;
    }
    .explanation-box {
      margin-top: 15px;
      padding: 14px;
      border-radius: 10px;
      background: #FFF9E6;
      border-right: 4.5px solid var(--accent);
      font-size: 0.94rem;
      line-height: 1.75;
      display: none;
    }
    .learning-tag {
      display: inline-block;
      background: var(--dark);
      color: #FFF;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 6px;
      margin-bottom: 6px;
      font-weight: 700;
    }
    .actions-bar {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-top: 30px;
      flex-wrap: wrap;
    }
    .btn {
      padding: 12px 28px;
      border-radius: 30px;
      font-size: 1.1rem;
      font-weight: 800;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.25s ease;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .btn-submit {
      background: linear-gradient(135deg, var(--secondary), #D81B60);
      color: #FFF;
    }
    .btn-submit:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(236,39,95,0.35); }
    .btn-reset {
      background: #E2E8F0;
      color: var(--dark);
      display: none;
    }
    .result-hero {
      background: linear-gradient(135deg, var(--dark), #172B4D);
      color: #FFF;
      border-radius: 16px;
      padding: 25px;
      text-align: center;
      margin-bottom: 30px;
      display: none;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }
    .score-circle {
      font-family: 'Lalezar', cursive;
      font-size: 3rem;
      color: #FFE938;
      margin: 10px 0;
    }
    .score-grade {
      font-size: 1.25rem;
      font-weight: 800;
      color: #FFF;
    }
    .quiz-footer {
      text-align: center;
      margin-top: 35px;
      padding-top: 15px;
      border-top: 1.5px dashed var(--primary);
      font-size: 0.88rem;
      color: #64748B;
      font-weight: 700;
    }
  </style>
</head>
<body>

<div class="quiz-container">
  ${isPartner ? `
  <div class="partner-header">
    <span>🎓 بشراكة رسمية مع بوت Thanawiyah للثانوية العامة</span>
    <span style="background:var(--secondary);padding:2px 8px;border-radius:4px;font-weight:800;">سلسلة المتفوق 2027</span>
  </div>` : ''}

  <div class="quiz-head">
    <div class="quiz-badge">🧠 كويز تفاعلي ذاتي التصحيح</div>
    <h1 class="quiz-title">${safeTitle}</h1>
  </div>

  <div class="quiz-meta-bar">
    <span>📚 المادة: <strong>${safeSubject}</strong></span>
    <span>📊 عدد الأسئلة: <strong>${questions.length} سؤال</strong></span>
    <span>🎯 معايير: <strong>البكالوريا المصرية 2027</strong></span>
    <div class="timer-badge">⏱️ <span id="timerText">15:00</span></div>
  </div>

  <div class="progress-bar-wrap">
    <div class="progress-bar-fill" id="progressFill"></div>
  </div>

  <!-- صندوق النتيجة بعد التسليم -->
  <div class="result-hero" id="resultHero">
    <div class="score-grade" id="resultGradeText">🌟 تم تقييم إجاباتك بنجاح!</div>
    <div class="score-circle" id="resultScoreText">0%</div>
    <p id="resultDetailText" style="font-size: 1rem; color: #E2E8F0;"></p>
  </div>

  <!-- حاوية الأسئلة -->
  <form id="quizForm">
    <div id="questionsContainer"></div>

    <div class="actions-bar">
      <button type="button" class="btn btn-submit" id="submitBtn" onclick="gradeQuiz()">🎯 تسليم وتصحيح الكويز</button>
      <button type="button" class="btn btn-reset" id="resetBtn" onclick="resetQuiz()">🔄 إعادة المحاولة من جديد</button>
    </div>
  </form>

  <div class="quiz-footer">
    🌟 سلسلة «المتفوق» — نجتهد لنوفق 🌟 | ولا تنسوا الصلاة على النبي ﷺ | إعداد: @A7med19_7
  </div>
</div>

<script>
  const questions = ${questionsJson};
  let secondsRemaining = 15 * 60;
  let timerInterval = null;
  let isGraded = false;

  function renderQuiz() {
    const container = document.getElementById('questionsContainer');
    container.innerHTML = '';

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const optionLabels = ['أ', 'ب', 'ج', 'د'];

    questions.forEach((q, qIndex) => {
      const card = document.createElement('div');
      card.className = 'q-card';
      card.id = 'card-' + qIndex;

      let optionsHtml = '';
      q.options.forEach((opt, optIndex) => {
        optionsHtml += \`
          <label class="opt-label" id="opt-label-\${qIndex}-\${optIndex}">
            <input type="radio" name="q\${qIndex}" value="\${optIndex}" onchange="updateProgress()">
            <span><strong>(${optionLabels[optIndex] || optIndex + 1})</strong> \${escapeHtml(opt)}</span>
          </label>
        \`;
      });

      card.innerHTML = \`
        <div class="q-header">
          <div class="q-num">\${qIndex + 1}</div>
          <div class="q-text">\${escapeHtml(q.question)}</div>
        </div>
        <div class="q-options">
          \${optionsHtml}
        </div>
        <div class="explanation-box" id="exp-\${qIndex}">
          <div class="learning-tag">🎯 \${q.learningOutcome || 'نواتج التعلم والتفكير 2027'}</div>
          <div>💡 <strong>التفسير والتحليل العلمي:</strong> \${escapeHtml(q.explanation)}</div>
        </div>
      \`;

      container.appendChild(card);
    });

    if (window.renderMathInElement) {
      renderMathInElement(container, {
        delimiters: [
          { left: '\\\\[', right: '\\\\]', display: true },
          { left: '\\\\(', right: '\\\\)', display: false }
        ],
        throwOnError: false
      });
    }

    startTimer();
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (secondsRemaining <= 0) {
        clearInterval(timerInterval);
        if (!isGraded) gradeQuiz();
        return;
      }
      secondsRemaining--;
      const mins = Math.floor(secondsRemaining / 60);
      const secs = secondsRemaining % 60;
      document.getElementById('timerText').textContent = 
        String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }, 1000);
  }

  function updateProgress() {
    let answered = 0;
    questions.forEach((_, qIndex) => {
      const selected = document.querySelector('input[name="q' + qIndex + '"]:checked');
      if (selected) answered++;
    });
    const percent = Math.round((answered / questions.length) * 100);
    document.getElementById('progressFill').style.width = percent + '%';
  }

  function gradeQuiz() {
    if (isGraded) return;
    isGraded = true;
    clearInterval(timerInterval);

    let score = 0;

    questions.forEach((q, qIndex) => {
      const card = document.getElementById('card-' + qIndex);
      const selectedInput = document.querySelector('input[name="q' + qIndex + '"]:checked');
      const correctIdx = q.correctOptionIndex;
      const selectedIdx = selectedInput ? parseInt(selectedInput.value) : -1;

      // إظهار التفسير
      const expBox = document.getElementById('exp-' + qIndex);
      if (expBox) expBox.style.display = 'block';

      // تعطيل الاختيارات
      document.querySelectorAll('input[name="q' + qIndex + '"]').forEach(inp => inp.disabled = true);

      // تحديد الإجابة الصحيحة والخاطئة
      const correctLabel = document.getElementById('opt-label-' + qIndex + '-' + correctIdx);
      if (correctLabel) correctLabel.classList.add('ans-correct');

      if (selectedIdx === correctIdx) {
        score++;
        card.classList.add('correct-ans');
      } else {
        card.classList.add('wrong-ans');
        if (selectedIdx !== -1) {
          const wrongLabel = document.getElementById('opt-label-' + qIndex + '-' + selectedIdx);
          if (wrongLabel) wrongLabel.classList.add('ans-wrong');
        }
      }
    });

    const percent = Math.round((score / questions.length) * 100);
    const hero = document.getElementById('resultHero');
    hero.style.display = 'block';
    document.getElementById('resultScoreText').textContent = percent + '% (' + score + ' من ' + questions.length + ')';

    let gradeText = '';
    if (percent >= 90) gradeText = '🌟 ممتاز! أداء استثنائي مطابق لمستويات تفوق البكالوريا 2027 👏';
    else if (percent >= 75) gradeText = '👏 جيد جداً! فهم عميق ومتميز لنواتج التعلم 💪';
    else if (percent >= 50) gradeText = '👍 جيد! اجتزت الكويز، وراجع التفسيرات العلمية أدناه للإتقان 💡';
    else gradeText = '💡 تحتاج إلى مراجعة الدرس مجدداً! اطلع على نواتج التعلم وتفسير كل سؤال بالأسفل 📖';

    document.getElementById('resultGradeText').textContent = gradeText;
    document.getElementById('resultDetailText').textContent = 
      'أجبت إجابة صحيحة على ' + score + ' أسئلة من أصل ' + questions.length + '، وراجعت التفسيرات العلمية الموضحة تحت كل سؤال.';

    document.getElementById('submitBtn').style.display = 'none';
    document.getElementById('resetBtn').style.display = 'inline-flex';

    // التمرير لأعلى لعرض النتيجة
    hero.scrollIntoView({ behavior: 'smooth' });
  }

  function resetQuiz() {
    isGraded = false;
    secondsRemaining = 15 * 60;
    document.getElementById('resultHero').style.display = 'none';
    document.getElementById('submitBtn').style.display = 'inline-flex';
    document.getElementById('resetBtn').style.display = 'none';
    document.getElementById('progressFill').style.width = '0%';
    renderQuiz();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // تشغيل الكويز عند فتح الصفحة
  window.onload = renderQuiz;
</script>
</body>
</html>`;

  return htmlContent;
}
