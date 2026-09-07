import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSystemPrompt } from './systemPrompt.js';
import { processGeneratedHtml } from './fontsHelper.js';
import { getApiKeyPool } from './apiKeyManager.js';

// gemini-2.5-flash لم يعد متاحاً للمستخدمين الجدد.
const CURRENT_MODEL = 'gemini-3.6-flash';
const RETIRED_MODELS = new Set(['gemini-2.5-flash', 'gemini-3.5-flash']);

function normalizeModelName(modelName) {
  const candidate = String(modelName || '').trim();
  return RETIRED_MODELS.has(candidate) ? CURRENT_MODEL : (candidate || CURRENT_MODEL);
}

function modelCandidates(modelName) {
  return [...new Set([normalizeModelName(modelName), CURRENT_MODEL])];
}

function isQuotaError(error) {
  const message = String(error?.message || error || '');
  return error?.status === 429 || /429|quota|too many requests|rate limit/i.test(message);
}

function quotaError() {
  const error = new Error('انتهت حصة Gemini الحالية. انتظر حتى تجدد الحصة أو استخدم مفتاحاً/خطة مدفوعة ثم أعد المحاولة.');
  error.code = 'GEMINI_QUOTA_EXCEEDED';
  error.status = 429;
  return error;
}

export function extractLessonTitle(htmlCode, fallbackTitle = 'ملزمة جديدة') {
  try {
    const titleMatch = htmlCode.match(/<title>(.*?)<\/title>/i) ||
                       htmlCode.match(/<span class="tt">(.*?)<\/span>/i) ||
                       htmlCode.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (titleMatch && titleMatch[1]) {
      let rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      rawTitle = rawTitle.replace(/سلسلة|المتفوق|–|-|—/g, ' ').trim();
      const safeTitle = rawTitle.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_').replace(/^_+|_+$/g, '');
      if (safeTitle.length > 2) {
        return safeTitle.slice(0, 50);
      }
    }
  } catch (_) {}
  return fallbackTitle.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
}

/**
 * يقرأ المصدر أولاً ويعيد مخططاً مختصراً قبل بدء كتابة الملزمة.
 * المخطط لا يتحول إلى محتوى مستقل؛ بل يستخدم لتوجيه التوزيع ومنع خلط المواد.
 */
export async function createLessonPlan({
  apiKey,
  userPrompt = '',
  modelName = CURRENT_MODEL,
  imageBuffer = null,
  imageMimeType = 'image/jpeg',
  images = [],
  audioBuffer = null,
  audioMimeType = 'audio/ogg',
  sourceType = 'text'
}) {
  const keyPool = getApiKeyPool(apiKey);
  if (!keyPool.length) throw new Error('مفتاح GEMINI_API_KEY غير متوفر.');
  const parts = [{ text: `
أنت محلل محتوى تعليمي. حلل المصدر المرفق قبل الكتابة وأعد مخططاً داخلياً دقيقاً باللغة العربية.
لا تكتب HTML ولا تشرح خارج المخطط. لا تفترض مساراً دراسياً، ولا تستخدم أمثلة طبية أو هندسية أو اقتصادية أو أدبية إلا إذا ظهرت فعلاً في المصدر.
إذا كان المصدر لغة إنجليزية فحدد موضوع اللغة ومهاراتها فقط.
أخرج بالترتيب:
1) المادة والموضوع كما يظهران في المصدر.
2) العناوين والمفاهيم بالترتيب.
3) الأمثلة/النصوص/القواعد التي يجب الحفاظ عليها.
4) توزيع مقترح من 2 إلى 10 صفحات مع وظيفة كل صفحة.
5) قائمة تحقق للدقة وما يجب عدم إضافته.
المصدر النصي أو الوصفي:
${userPrompt || 'حلل الصور أو الصوت المرفقين فقط.'}
` }];
  for (const item of images || []) {
    if (item.buffer) parts.push({ inlineData: { data: item.buffer.toString('base64'), mimeType: item.mimeType || 'image/jpeg' } });
  }
  if (imageBuffer) parts.push({ inlineData: { data: imageBuffer.toString('base64'), mimeType: imageMimeType } });
  if (audioBuffer) parts.push({ inlineData: { data: audioBuffer.toString('base64'), mimeType: audioMimeType } });
  let lastError = null;
  for (const key of keyPool) {
    for (const modelNameToTry of modelCandidates(modelName)) {
      try {
        const model = new GoogleGenerativeAI(key).getGenerativeModel({
          model: modelNameToTry,
          generationConfig: { temperature: 0.05, maxOutputTokens: 5000 }
        });
        const result = await model.generateContent(parts);
        const plan = result.response.text()?.trim();
        if (plan && plan.length > 80) return plan.slice(0, 16000);
      } catch (error) {
        if (isQuotaError(error)) {
          lastError = quotaError();
          break;
        }
        lastError = error;
      }
    }
  }
  throw new Error(`تعذر إعداد مخطط الملزمة: ${lastError?.message || 'خطأ غير معروف'}`);
}

export async function generateLessonHtml({
  apiKey,
  userPrompt,
  selectedIdentity = '🎀 الورقة الملونة',
  isPartner = true,
  modelName = CURRENT_MODEL,
  imageBuffer = null,
  imageMimeType = 'image/jpeg',
  images = [],
  audioBuffer = null,
  audioMimeType = 'audio/ogg',
  sourceType = 'text',
  track = 'auto',
  lessonPlan = ''
}) {
  const keyPool = getApiKeyPool(apiKey);

  if (!keyPool || keyPool.length === 0 || !keyPool[0]) {
    throw new Error('مفتاح GEMINI_API_KEY غير متوفر في ملف .env أو في إعدادات الخدمة.');
  }

  const systemInstruction = getSystemPrompt(selectedIdentity, isPartner, `${userPrompt || ''}
${lessonPlan || ''}`, track);
      const modelsToTry = modelCandidates(modelName);
  const uniqueModels = [...new Set(modelsToTry.filter(Boolean))];
  let lastError = null;

  // توحيد قائمة الصور
  const allImages = [...(images || [])];
  if (imageBuffer && allImages.length === 0) {
    allImages.push({ buffer: imageBuffer, mimeType: imageMimeType || 'image/jpeg' });
  }

  for (let keyIndex = 0; keyIndex < keyPool.length; keyIndex++) {
    const currentApiKey = keyPool[keyIndex];
    const genAI = new GoogleGenerativeAI(currentApiKey);

    for (const currentModel of uniqueModels) {
      try {
        console.log(`توليد ملزمة قد تمتد لـ 10 صفحات بالمفتاح [${keyIndex + 1}/${keyPool.length}] نموذج: ${currentModel} (عدد الصور: ${allImages.length})...`);
        const model = genAI.getGenerativeModel({
          model: currentModel,
          systemInstruction: systemInstruction,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 32768, // رفع سقف التوكنات لإنشاء ملازم كبيرة تصل لـ 10 صفحات A4 دون انقطاع
          }
        });

        let visualDossier = '';
        if (allImages.length > 0) {
          try {
            const inspectionModel = genAI.getGenerativeModel({
              model: currentModel,
              generationConfig: { temperature: 0.05, responseMimeType: 'application/json', maxOutputTokens: 16384 }
            });
            const inspectionPrompt = `أنت محلل صور تعليمية وOCR دقيق. افحص كل الصور واحدة واحدة وأعد JSON فقط:
{"documentTitle":"العنوان","subject":"المادة","pages":[{"pageNumber":1,"headings":[],"verbatimText":"النص والأرقام كما ظهرت","formulas":[],"examples":[],"figuresAndTables":[],"uncertainParts":[]}],"coverageChecklist":[]}
قواعد صارمة: لا تخترع نصاً غير ظاهر. ضع الكلمات أو الأرقام غير المقروءة في uncertainParts بدلاً من تخمينها. يجب تمثيل كل صورة في pages والحفاظ على الوحدات والأرقام.
`;
            const inspectionParts = [inspectionPrompt, ...allImages.filter(img => img.buffer).map(img => ({ inlineData: { data: img.buffer.toString('base64'), mimeType: img.mimeType || 'image/jpeg' } }))];
            const inspectionResult = await inspectionModel.generateContent(inspectionParts);
            const inspected = JSON.parse(inspectionResult.response.text());
            if (inspected?.pages?.length && inspected?.coverageChecklist?.length) {
              visualDossier = JSON.stringify(inspected, null, 2).slice(0, 50000);
              console.log(`🔎 تم تحليل ${inspected.pages.length} صورة/صفحة وإنشاء قائمة تغطية من ${inspected.coverageChecklist.length} موضوعاً.`);
            }
          } catch (inspectionError) {
            if (isQuotaError(inspectionError)) throw quotaError();
            console.warn('⚠️ تعذر التحليل المنظم للصور، سيتم استخدام الصور مباشرة:', inspectionError.message);
          }
        }

        let contentParts = [];

        let sourceTypeInstruction = '';
        if (sourceType === 'youtube') {
          sourceTypeInstruction = `📌 المصدر الحالي: تفريغ محاضرة يوتيوب. قم بفصل المحتوى العلمي وتنسيقه كاملاً بأسئلة كويز على عدد الصفحات المناسب (حتى 10 صفحات).`;
        } else if (sourceType === 'pdf') {
          sourceTypeInstruction = `📌 المصدر الحالي: ملف مستند PDF. قم بقراءة وتجميع المحتوى والجداول بالكامل وتوزيعها على صفحات A4 حتى 10 صفحات.`;
        } else if (allImages.length > 1) {
          sourceTypeInstruction = `📌 المصدر الحالي: عدد (${allImages.length}) صور ولقطات دراسية مجمعة أرسلها الطالب/المعلم معاً.
⚠️ **مهم جداً:** قم بقراءة وفهم وتحليل كافة الصور المرفقة معاً كدرس ومحتوى دراسي واحد مترابط ومتكامل، ورتّب الأفكار والمعلومات والمعادلات والقوانين من جميع الصور تسلسلياً في ملف واحد شامل يجمع (الشرح المتكامل + التطبيقات المحلولة + قسم «✍️ حِلّ بإيدك» المخطط + بنك الأسئلة والتمارين لمناهج البكالوريا 2027).`;
        } else if (allImages.length === 1 || sourceType === 'image') {
          sourceTypeInstruction = `📌 المصدر الحالي: صورة / لقطة سبورة (OCR). قم بقراءة وفهم وتفريغ كافة الكلمات والجداول والمعادلات والملاحظات بالكامل وصياغة ملزمة متكاملة مع التطبيقات والأسئلة.`;
        } else if (sourceType === 'audio') {
          sourceTypeInstruction = `📌 المصدر الحالي: بصمة صوتية للمعلم. قم بسماع وتفريغ الشرح الصوتي كاملاً.`;
        }

        const promptText = `
${sourceTypeInstruction}
المطلوب: إنشاء ملزمة / مراجعة A4 بصيغة HTML كاملة ومكتفية بذاتها وفقاً لقواعد «المتفوق» للبكالوريا المصرية 2027، مقسمة على عدد الصفحات المناسب بحسب طول المحتوى (من 2 إلى 10 صفحات A4).
⏳ **مرحلة الدقة قبل الإخراج:** لا تبدأ كتابة HTML مباشرة. أولاً افحص كل الصور/النصوص، وأنشئ داخلياً جرداً لكل عنوان وقانون ومثال ونظرية ورمز ظاهر، ثم طابق الجرد مع الأقسام الناتجة.
🧩 **المخطط المعتمد قبل الكتابة:**
${lessonPlan || 'أنشئ مخططاً داخلياً من المصدر قبل كتابة الصفحات، ولا تضف أي قسم غير مؤيد بالمصدر.'} يجب ألا يسقط أي موضوع، وخاصة الجبر والأعداد المركبة وذات الحدين والهندسة والدوائر عند ظهورها في المصدر.
🔍 **مراجعة نهائية إلزامية:** قبل إخراج HTML راجع الأرقام والرموز العربية والـLaTeX، واحذف أي رمز غريب أو placeholder، وتأكد أن كل قسم من المصدر ظهر في الملزمة مرة واحدة على الأقل دون اختراع موضوع خارج المصدر. لا تعرض جردك الداخلي؛ أخرج HTML فقط.

${visualDossier ? `📚 تقرير التحليل البصري الموثق — استخدمه كخريطة تغطية ولا تخالف النص الظاهر في الصور:\n${visualDossier}` : ''}

المحتوى النصي أو التوضيحي المرفق:
${userPrompt || 'قم بتحليل وقراءة واستخراج كافة التفاصيل والشروحات والمعادلات من الصور والمحتوى المرفق ودمجها في ملزمة واحدة متكاملة.'}

خطة التوزيع التي يجب تنفيذها دون اختراع محتوى:
${lessonPlan || 'خطة مستخرجة داخلياً من المصدر فقط.'}
`;

        contentParts.push(promptText);

        // إرفاق جميع الصور المجمعة
        for (const img of allImages) {
          if (img.buffer) {
            contentParts.push({
              inlineData: {
                data: img.buffer.toString('base64'),
                mimeType: img.mimeType || 'image/jpeg'
              }
            });
          }
        }

        if (audioBuffer) {
          contentParts.push({
            inlineData: { data: audioBuffer.toString('base64'), mimeType: audioMimeType }
          });
        }

        const result = await model.generateContent(contentParts);
        let responseText = result.response.text();

        // عند بلوغ سقف التوكنات قد يترك النموذج HTML بلا </html>. لا نمرر
        // المخرج المبتور إلى PDF؛ نطلب نسخة مكتملة ومضغوطة مرة واحدة على
        // نفس المفتاح/النموذج قبل الانتقال إلى المفتاح التالي.
        const looksTruncated = (value) => {
          const source = String(value || '');
          return !/<\/html>\s*$/i.test(source) || !/<div[^>]*class=["'][^"']*\bpg\b/i.test(source);
        };
        if (responseText && responseText.length > 50 && looksTruncated(responseText)) {
          const compactParts = [...contentParts, { text: `\nإعادة إخراج إلزامية: المخرج السابق مبتور أو ناقص. أعد كتابة HTML كاملاً ومكتفياً بذاته من 2 إلى 6 صفحات A4 فقط، مع الحفاظ على كل المعلومات الأساسية. ابدأ بـ <!DOCTYPE html> وأنهِ بـ </html> ولا تكتب أي Markdown أو شرح خارج HTML.` }];
          const compactResult = await model.generateContent(compactParts);
          responseText = compactResult.response.text();
        }
        if (responseText && responseText.length > 50) return processGeneratedHtml(responseText);
      } catch (err) {
        if (isQuotaError(err)) {
          lastError = quotaError();
          break;
        }
        console.warn(`فشلت المحاولة بالمفتاح [${keyIndex + 1}/${keyPool.length}]:`, err.message);
        lastError = err;
      }
    }
  }

  throw new Error(`فشل توليد الكود من جميع مفاتيح الـ API. الخطأ الأخير: ${lastError?.message || 'غير معروف'}`);
}

export async function modifyLessonHtml({
  apiKey,
  existingHtml,
  editInstructions,
  selectedIdentity = '🎀 الورقة الملونة',
  isPartner = true,
  modelName = CURRENT_MODEL,
  track = 'auto'
}) {
  const keyPool = getApiKeyPool(apiKey);
  const systemInstruction = getSystemPrompt(selectedIdentity, isPartner, editInstructions || existingHtml, track);
  const modelsToTry = modelCandidates(modelName);
  const uniqueModels = [...new Set(modelsToTry.filter(Boolean))];
  let lastError = null;

  for (let keyIndex = 0; keyIndex < keyPool.length; keyIndex++) {
    const currentApiKey = keyPool[keyIndex];
    const genAI = new GoogleGenerativeAI(currentApiKey);

    for (const currentModel of uniqueModels) {
      try {
        console.log(`تعديل وتوسيع الملزمة حتى 10 صفحات بالمفتاح [${keyIndex + 1}/${keyPool.length}] نموذج: ${currentModel}...`);
        const model = genAI.getGenerativeModel({
          model: currentModel,
          systemInstruction: systemInstruction,
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 32768,
          }
        });

        const promptText = `
أنت الآن تقوم بتعديل وتحديث ملزمة تعليمية موجودة مسبقاً (مع إمكانية توسيعها وإضافة صفحات A4 جديدة حتى 10 صفحات عند الحاجة).

التعديلات والملاحظات المطلوبة من المعلم/المستخدم:
"${editInstructions}"

كود الـ HTML الحالي المراد تعديله:
\`\`\`html
${existingHtml}
\`\`\`

المطلوب:
تطبيق التعديلات المطلوبة بالكامل (إضافة أسئلة، إضافة مواضيع، توسيع صفحات) وإعادة إخراج كود الـ HTML الكامل المعدل والنقي.
`;

        const result = await model.generateContent(promptText);
        const responseText = result.response.text();

        if (responseText && responseText.length > 50) {
          return processGeneratedHtml(responseText);
        }
      } catch (err) {
        if (isQuotaError(err)) {
          lastError = quotaError();
          break;
        }
        lastError = err;
      }
    }
  }

  throw new Error(`تعذر تطبيق التعديلات المطلوب: ${lastError?.message || 'غير معروف'}`);
}
