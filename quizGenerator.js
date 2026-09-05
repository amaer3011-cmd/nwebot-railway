import { GoogleGenerativeAI } from '@google/generative-ai';
import { processGeneratedHtml } from './fontsHelper.js';
import { DESIGN_CATALOG } from './designCatalog.js';
import { detectSubjectGuidelines } from './baccalaureateStandards2027.js';
import { getApiKeyPool } from './apiKeyManager.js';

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
  const modelsToTry = [modelName, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
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
أنت خبير تربوي متخصص وموجه أول ومستشار مادة في وضع امتحانات وبنوك أسئلة «البكالوريا المصرية 2027» بمساراتها الأربعة (الطب، الهندسة، الأعمال، الآداب).
📌 التخصص والمادة المستهدفة: **${subjectInfo.subjectName}** (${subjectInfo.trackTitle})

المطلوب: قم بإنشاء ${count} سؤال بنمط: ${typePromptMap[quizType] || typePromptMap.mcq}

مستوى الصعوبة والتوزيع: ${difficultyMap[difficulty] || difficultyMap.mixed}

🎓 مواصفات ومعايير أسئلة البكالوريا 2027 التخصصية لمادة (${subjectInfo.subjectName}):
${subjectInfo.guidelines}

📊 التوزيع المعرفي الإلزامي للأسئلة:
- ${subjectInfo.cognitiveDistribution.understanding}
- ${subjectInfo.cognitiveDistribution.application}
- ${subjectInfo.cognitiveDistribution.higherThinking}

⚖️ المبادئ الفنية الصارمة:
${subjectInfo.generalPrinciples.map(p => `• ${p}`).join('\n')}

يجب أن ينتهي المخرج كـ JSON Array يتبع هذا التنسيق بالضبط:
[
  {
    "question": "نص السؤال هنا",
    "options": ${quizType === 'truefalse' ? '["صح ✅", "غلط ❌"]' : '["اختيار 1", "اختيار 2", "اختيار 3", "اختيار 4"]'},
    "correctOptionIndex": 0,
    "explanation": "شرح موجز ودقيق لسبب صحة هذا الخيار وناتج التعلم المستهدف",
    "learningOutcome": "ناتج التعلم المستهدف (مثل: استنتاج علاقة / تطبيق قانون عكسي / تحليل دلالة)",
    "difficulty": "easy|medium|hard"
  }
]

المحتوى العلمي المرجعي:
${contentText.slice(0, 6000)}
`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const quizItems = JSON.parse(text);

        if (Array.isArray(quizItems) && quizItems.length > 0) {
          return quizItems.map(item => ({
            question: item.question.slice(0, 255),
            options: item.options.map(opt => String(opt).slice(0, 100)),
            correctOptionIndex: Math.min(Math.max(0, item.correctOptionIndex || 0), item.options.length - 1),
            explanation: item.explanation ? item.explanation.slice(0, 250) : '',
            learningOutcome: item.learningOutcome ? item.learningOutcome.slice(0, 100) : 'نواتج تعلم البكالوريا 2027',
            difficulty: item.difficulty || 'mixed'
          }));
        }
      } catch (err) {
        console.warn(`فشلت محاولة الكويز بالمفتاح [${keyIndex + 1}/${keyPool.length}]:`, err.message);
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
  const modelsToTry = [modelName, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
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

⚠️ **حظر هام:** مخرجك يجب أن يكون **كود HTML نقي** يبدأ فوراً بـ \`<!DOCTYPE html>\` وينتهي بـ \`</html>\` بدون أي نص خارجي.

المطلوب: تصميم **كويز احترافي مطبوع** يحتوي على ${count} سؤال اختيار من متعدد ومقالي بصيغة HTML/A4 جاهزة للطباعة كـ PDF وفق معايير البكالوريا 2027.

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

استخدم نظام الـ CSS التالي داخل وسم <style>:
\`\`\`css
${customCss}
\`\`\`

📐 تصميم الكويز:
1. **صفحة الغلاف:** شريط الشراكة + هيدر مع عنوان الكويز + الشعار + عدد الأسئلة والتعليمات
2. **الأسئلة:** كل سؤال مرقم بوضوح مع 4 اختيارات (A, B, C, D) مع دوائر أو مربعات اختيار فارغة ☐
3. **مساحة «حل بإيدك»:** مساحة مخططة كلاس \`.workspace-area\` بين أو بعد كل مجموعة أسئلة ليكتب الطالب مسودته وملاحظاته
4. **مفتاح الإجابات:** في نهاية الكويز، جدول أو بطاقة \`.answer-key\` بالإجابات النموذجية مع شرح موجز لكل إجابة
5. **الفوتر:** «ولا تنسو الصلاة علي النبي ﷺ» + «نجتهد لنوفق 🌟» + @A7med19_7

⚠️ الدقة العلمية 100%: تأكد من صحة كل سؤال وصحة الخيار المعلم كإجابة صحيحة قبل الإخراج بدون أي التباس.

📄 القواعد التقنية:
- كل صفحة بحاوية: \`<div class="pg">\` ... \`</div>\` بأبعاد \`210mm x 296mm\`
- \`break-after: page;\` لكل صفحة
- الخطوط: Google Fonts (Cairo, Lalezar, Aref Ruqaa)
- اتجاه RTL

المحتوى العلمي المرجعي لإنشاء الأسئلة:
${contentText.slice(0, 6000)}
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
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Lalezar&display=swap" rel="stylesheet">
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
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Cairo', sans-serif; }
    body {
      background: var(--bg);
      color: var(--dark);
      padding: 20px 10px;
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
      padding: 25px;
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
      font-size: 0.85rem;
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
      font-size: 1.3rem;
      font-weight: 800;
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
      padding: 20px;
      margin-bottom: 22px;
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
      font-size: 1.05rem;
      font-weight: 700;
      line-height: 1.6;
      color: var(--dark);
    }
    .q-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .opt-label {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border: 1.5px solid var(--border-color);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      background: #FFF;
      font-size: 0.98rem;
      font-weight: 600;
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
      font-size: 0.92rem;
      line-height: 1.6;
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
    🌟 سلسلة «المتفوق» — نجتهد لنوفق 🌟 | ولا تنسو الصلاة علي النبي ﷺ | إعداد: @A7med19_7
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

    questions.forEach((q, qIndex) => {
      const card = document.createElement('div');
      card.className = 'q-card';
      card.id = 'card-' + qIndex;

      let optionsHtml = '';
      q.options.forEach((opt, optIndex) => {
        optionsHtml += \`
          <label class="opt-label" id="opt-label-\${qIndex}-\${optIndex}">
            <input type="radio" name="q\${qIndex}" value="\${optIndex}" onchange="updateProgress()">
            <span>\${opt}</span>
          </label>
        \`;
      });

      card.innerHTML = \`
        <div class="q-header">
          <div class="q-num">\${qIndex + 1}</div>
          <div class="q-text">\${q.question}</div>
        </div>
        <div class="q-options">
          \${optionsHtml}
        </div>
        <div class="explanation-box" id="exp-\${qIndex}">
          <div class="learning-tag">🎯 \${q.learningOutcome || 'نواتج التعلم والتفكير 2027'}</div>
          <div>💡 <strong>التفسير والتحليل العلمي:</strong> \${q.explanation}</div>
        </div>
      \`;

      container.appendChild(card);
    });

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

