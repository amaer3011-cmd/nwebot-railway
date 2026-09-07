import { Bot, InlineKeyboard, Keyboard, InputFile } from 'grammy';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { generateLessonHtml, createLessonPlan, modifyLessonHtml, extractLessonTitle } from './aiService.js';
import { extractYoutubeTranscript, extractPdfText, getSourceQualityAdvisor } from './sourceExtractor.js';
import { convertHtmlToPdf, renderHtmlDirectlyToPdf } from './pdfRenderer.js';
import { generateInteractiveQuiz, generateQuizPdf, generateSelfGradingHtmlQuiz, createUnansweredQuizHtml } from './quizGenerator.js';
import { processGeneratedHtml } from './fontsHelper.js';
import { getApiKeyPool, hasValidApiKey, getPrimaryApiKey } from './apiKeyManager.js';
import { getUserSession, markSessionsDirty, flushSessions } from './sessionStore.js';
import { sanitizeDocumentHtml, publicErrorMessage } from './htmlSecurity.js';

dotenv.config({ override: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = getPrimaryApiKey();
const defaultModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const loadedKeys = getApiKeyPool();

if (!botToken || botToken.trim() === '' || botToken.includes('your_telegram_bot_token_here')) {
  console.warn('⚠️ تنبيه: TELEGRAM_BOT_TOKEN غير مضبوط في ملف .env');
}

if (!hasValidApiKey()) {
  console.warn('⚠️ تنبيه: لم يتم ضبط أي مفتاح Gemini API صالح في ملف .env (يمكنك إضافة حتى 7 مفاتيح GEMINI_API_KEY_1 إلى GEMINI_API_KEY_7)');
} else {
  console.log(`🔑 تم تحميل (${loadedKeys.length}) مفتاح Gemini API بنجاح مع التدوير التلقائي الفوري!`);
}

const bot = new Bot(botToken || 'DUMMY_TOKEN');
let botReady = false;

// 🛡️ حماية السيرفر من الانهيار عند حدوث انقطاع مؤقت في شبكة تليجرام (ECONNRESET / ETIMEDOUT)
process.on('uncaughtException', (err) => {
  console.error('⚠️ [UncaughtException Guard]:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [UnhandledRejection Guard]:', reason?.message || reason);
});

// 🛡️ معالج أخطاء عام لمنع توقف البوت في أي ظرف
bot.catch((err) => {
  const ctx = err.ctx;
  console.warn(`⚠️ خطأ في معالجة التحديث [${ctx?.update?.update_id}]:`, err.error?.message || err.message);
});

// 🛡️ دالة مساعدة للإرسال الآمن مع إعادة المحاولة عند انقطاع الشبكة
async function safeReply(ctx, text, options = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await ctx.reply(text, options);
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}

async function safeEditMessageText(ctx, text, options = {}) {
  try {
    return await ctx.editMessageText(text, options);
  } catch (err) {
    const message = err?.description || err?.message || '';
    if (message.includes('there is no text to edit') || message.includes('message is not modified')) {
      return await ctx.reply(text, options);
    }
    throw err;
  }
}

async function renderSafePdf(html, isLandscape = false) {
  const sanitized = sanitizeDocumentHtml(html);
  return renderHtmlDirectlyToPdf(sanitized, isLandscape);
}

async function fetchTelegramFile(url, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`تعذر تنزيل الملف من Telegram (HTTP ${response.status})`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// 🛡️ حماية الـ Callbacks من أخطاء انتهاء الصلاحية (Query too old)
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    const origAnswer = ctx.answerCallbackQuery.bind(ctx);
    ctx.answerCallbackQuery = async (...args) => {
      try {
        return await origAnswer(...args);
      } catch (_) {}
    };
  }
  await next();
});

// 🌐 البوت مفتوح للاستخدام العام بدون قائمة مستخدمين أو حد لعدد المستخدمين.
bot.use(async (ctx, next) => {
  await next();
  markSessionsDirty();
});

// 🎨 3. الهويات البصرية المتاحة
const IDENTITIES = [
  { id: 'colored_paper', name: '🎀 الورقة الملونة (الرسمية المعتمدة)' },
  { id: 'white_paper', name: '📖 الورق الأبيض — النظام العالمي' },
  { id: 'andalusian', name: '🕌 الطراز الأندلسي' },
  { id: 'pharaonic', name: '𓂀 الطراز الفرعوني الملكي' },
  { id: 'spread_book', name: '📖 كتاب الصفحتين (A4 Landscape)' },
  { id: 'notebook', name: '📒 الكشكول (الدفتر)' }
];

// 🧭 مسارات البكالوريا المصرية 2027
function getTrackBadge(trackId) {
  switch (trackId) {
    case 'medical': return '🩺 الطب وعلوم الحياة';
    case 'engineering': return '⚙️ الهندسة والتكنولوجيا';
    case 'business': return '💼 الأعمال والاقتصاد';
    case 'arts': return '🎨 الآداب والفنون';
    default: return '⚡ كشف تلقائي ذكي';
  }
}

function getMainMenuKeyboard() {
  return new InlineKeyboard()
    .text('📄 عمل ملزمة شرح A4 (PDF)', 'start_create_lesson')
    .row()
    .text('🧠 تصميم كويز احترافي (HTML / PDF)', 'start_create_quiz');
}

// 📌 الأوامر الأساسية
bot.command('start', async (ctx) => {
  const session = getUserSession(ctx.chat.id);
  const historyCount = session.lessonHistory ? session.lessonHistory.length : 0;

  const welcomeMessage = `
🌟 **مرحباً بك في مساعد «المتفوق» الذكي والأسطوري!** 🌟
🎓 **المتخصص حصرياً في مناهج «البكالوريا المصرية 2027»**

🧭 **المسار الحالي:** \`${getTrackBadge(session.track)}\`
*(يمكنك تغييره من زر المسارات أو تركه كشفاً تلقائياً بحسب محتوى الدرس)*

📢 **قناة المتفوق الرسمية:** [اضغط هنا للانضمام](https://t.me/+OAYxVF1Uqcs2NmE0)

ما الذي ترغب في إنجازه الآن؟

1️⃣ 📄 **عمل ملزمة شرح A4 (PDF):**
تفريغ الشرح وتنسيقه كاملاً حتى 10 صفحات مع خريطة مفاهيم ذهنية، قسم «حِلّ بإيدك» المخطط، ومفتاح الإجابات وتوزيع 50% موضوعي / 50% مقالي بدقة علمية 100%.

2️⃣ 🧠 **تصميم كويز احترافي:**
• **🌐 كويز ويب HTML تفاعلي:** يتصحح تلقائياً ويحسب درجتك ويعرض التفسير العلمي لكل سؤال!
• **📋 كويز PDF مطبوع:** جاهز للتوزيع مع دوائر ومفتاح إجابات بهوية «الورقة الملونة».
• **⚡ كويز Telegram Poll:** أسئلة تفاعلية حية داخل المحادثة.

${historyCount > 0 ? `📚 لديك **${historyCount} درس محفوظ** في مكتبتك السابقة يمكنك الاستعانة بها فوراً!` : ''}
`;

  await ctx.reply(welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
});

bot.command('track', async (ctx) => {
  const session = getUserSession(ctx.chat.id);
  await showTracksMenu(ctx, session);
});

bot.command('advisor', async (ctx) => {
  await ctx.reply(getSourceQualityAdvisor(), { parse_mode: 'Markdown' });
});

bot.command('help', async (ctx) => {
  const helpText = `
📖 **دليل استخدام مساعد «المتفوق» الشامل:**

1️⃣ **عمل ملزمة A4:** أرسل صورة، صوت، PDF، يوتيوب، أو نص وسيصلك ملف PDF باسم الدرس مع نسخة تعديل.
2️⃣ **تصميم كويز احترافي:** اكتب \`/quiz\` لاختيار نوع الكويز (HTML تفاعلي ذاتي التصحيح، أو PDF مطبوع، أو استطلاع تليجرام).
3️⃣ **مكتبة الدروس:** يسترجع البوت دروسك السابقة لتوليد مراجعات وكويزات سريعة منها دون إعادة الرفع!
`;
  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

bot.command('identity', async (ctx) => {
  await showIdentityMenu(ctx);
});

bot.command('partner', async (ctx) => {
  const session = getUserSession(ctx.chat.id);
  session.isPartner = !session.isPartner;
  await ctx.reply(`تم تحديث حالة الشراكة مع «بوت الثانوية العامة 🎓»: ${session.isPartner ? '🟢 مفعّلة رسمياً' : '🔴 معطّلة'}`, {
    reply_markup: getMainMenuKeyboard()
  });
});

// 🧠 أمر الكويز
bot.command('quiz', async (ctx) => {
  const session = getUserSession(ctx.chat.id);
  await showQuizMainMenu(ctx, session);
});

async function showQuizMainMenu(ctx, session) {
  const hasContent = !!session.lastContentText || !!session.lastHtml;
  const historyCount = session.lessonHistory ? session.lessonHistory.length : 0;
  const keyboard = new InlineKeyboard();

  if (hasContent) {
    keyboard.text('🌐 كويز ويب ذاتي التصحيح (HTML)', 'quiz_html_last')
      .row()
      .text('📋 كويز PDF احترافي للطباعة', 'quiz_pdf_last')
      .row()
      .text('⚡ كويز تفاعلي تليجرام (Poll)', 'quiz_quick_poll')
      .row();
  }

  if (historyCount > 0) {
    keyboard.text(`📚 كويز من درس سابق بمكتبتي (${historyCount})`, 'quiz_from_history')
      .row();
  }

  keyboard.text('✍️ كويز من موضوع / نص جديد', 'quiz_new_topic')
    .row()
    .text('⚙️ إعدادات الكويز', 'quiz_settings')
    .row()
    .text('🔙 القائمة الرئيسية', 'main_menu');

  const settingsText = `⚙️ الإعدادات: ${session.quizSettings.count} أسئلة | ${getQuizTypeName(session.quizSettings.type)} | ${getDifficultyName(session.quizSettings.difficulty)}`;

  const text = `
🧠 **مصمم الكويزات الاحترافي — معايير البكالوريا 2027**

${hasContent ? `📌 آخر درس نشط: **${session.lastTitle || 'درس بدون عنوان'}**` : '⚠️ يمكنك الاستعانة بدروسك السابقة أو إرسال موضوع جديد للكويز.'}

${settingsText}

🎯 **اختر نمط الكويز المطلوب:**
`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

function getQuizTypeName(type) {
  const map = { mcq: '🔢 اختيار من متعدد', truefalse: '✅❌ صح وغلط', complete: '📝 أكمل العبارة' };
  return map[type] || map.mcq;
}

function getDifficultyName(diff) {
  const map = { easy: '🟢 سهل', medium: '🟡 متوسط', hard: '🔴 صعب', mixed: '🎯 متنوع' };
  return map[diff] || map.mixed;
}

async function showIdentityMenu(ctx) {
  const keyboard = new InlineKeyboard();
  IDENTITIES.forEach((item, index) => {
    keyboard.text(item.name, `set_identity_${item.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  keyboard.row().text('🔙 العودة للقائمة الرئيسية', 'main_menu');

  const text = `🎨 **اختر الهوية البصرية المطلوبة للملازم (الافتراضي: 🎀 الورقة الملونة):**`;
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function showTracksMenu(ctx, session) {
  const current = session.track || 'auto';
  const keyboard = new InlineKeyboard()
    .text(current === 'auto' ? '⚡ كشف تلقائي ذكي ✅' : '⚡ كشف تلقائي ذكي', 'set_track_auto')
    .row()
    .text(current === 'medical' ? '🩺 مسار الطب وعلوم الحياة ✅' : '🩺 مسار الطب وعلوم الحياة', 'set_track_medical')
    .row()
    .text(current === 'engineering' ? '⚙️ مسار الهندسة والتكنولوجيا ✅' : '⚙️ مسار الهندسة والتكنولوجيا', 'set_track_engineering')
    .row()
    .text(current === 'business' ? '💼 مسار الأعمال والاقتصاد ✅' : '💼 مسار الأعمال والاقتصاد', 'set_track_business')
    .row()
    .text(current === 'arts' ? '🎨 مسار الآداب والفنون ✅' : '🎨 مسار الآداب والفنون', 'set_track_arts')
    .row()
    .text('🔙 العودة للقائمة الرئيسية', 'main_menu');

  const text = `
🧭 **مسارات نظام «البكالوريا المصرية 2027» الأربعة:**

اختر المسار التخصصي المستهدف لضبط منهجية الشرح وبنوك الأسئلة والكويزات:
• **🩺 الطب وعلوم الحياة:** أحياء متقدمة، كيمياء عضوية، فسيولوجيا ومناعة.
• **⚙️ الهندسة والتكنولوجيا:** رياضيات وفيزياء متقدمة، نمذجة، أسئلة «الفكرة وعكسها».
• **💼 الأعمال والاقتصاد:** اقتصاد متقدم، محاسبة، تحليل مالي وقوى السوق.
• **🎨 الآداب والفنون:** جغرافيا سياسية، علم نفس، نقد فكري ولغات.
• **⚡ كشف تلقائي:** يحلل البوت مادة الدرس تلقائياً ويطبق معاييرها بدقة.
`;
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

// 🔘 الأزرار التفاعلية
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const session = getUserSession(ctx.chat.id);

  if (data === 'menu_advisor') {
    await ctx.answerCallbackQuery();
    await ctx.reply(getSourceQualityAdvisor(), { parse_mode: 'Markdown' });
  } else if (data === 'menu_tracks') {
    await ctx.answerCallbackQuery();
    await showTracksMenu(ctx, session);
  } else if (data.startsWith('set_track_')) {
    const trackId = data.replace('set_track_', '');
    session.track = trackId;
    await ctx.answerCallbackQuery({ text: `تم اعتماد: ${getTrackBadge(trackId)}` });
    await ctx.editMessageText(`✅ **تم ضبط المسار بنجاح:**\n🎓 **${getTrackBadge(trackId)}**\n\nجميع الملازم والكويزات القادمة ستتبع معايير هذا المسار بدقة 100%.`, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard()
    });
  } else if (data === 'menu_identity') {
    await showIdentityMenu(ctx);
  } else if (data === 'toggle_partner') {
    session.isPartner = !session.isPartner;
    await ctx.answerCallbackQuery({ text: session.isPartner ? 'تم تفعيل الشراكة رسمياً 🟢' : 'تم تعطيل الشراكة 🔴' });
    await ctx.editMessageReplyMarkup({ reply_markup: getMainMenuKeyboard() });
  } else if (data === 'menu_help') {
    await ctx.answerCallbackQuery();
    await ctx.reply(`📖 أرسل أي درس وسيصلك ملف PDF باسم الدرس مع إمكانية التعديل عليه فوراً.`);
  } else if (data === 'main_menu') {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`🌟 **القائمة الرئيسية لمساعد «المتفوق»:**`, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard()
    });
  } else if (data.startsWith('set_identity_')) {
    const id = data.replace('set_identity_', '');
    const found = IDENTITIES.find(i => i.id === id);
    if (found) {
      session.identity = found.name;
      await ctx.answerCallbackQuery({ text: `تم اختيار ${found.name}` });
      await ctx.editMessageText(`✅ تم اعتماد الهوية البصرية:\n**${found.name}**`, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard()
      });
    }
  } else if (data === 'get_backup_html') {
    if (!session.lastHtml) {
      await ctx.answerCallbackQuery({ text: '⚠️ لا يوجد كود HTML احتياطي متوفر حالياً.', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: 'جاري إرسال نسخة الـ HTML الاحتياطية...' });
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const htmlFilename = `المتفوق_كود_${session.lastTitle || 'الدرس'}.html`;
    const htmlPath = path.join(tempDir, htmlFilename);
    fs.writeFileSync(htmlPath, session.lastHtml, 'utf-8');

    await ctx.replyWithDocument(new InputFile(htmlPath, htmlFilename), {
      caption: `💻 **كود HTML الاحتياطي الكامل لملزمة [${session.lastTitle || 'الدرس'}]**`
    });

    setTimeout(() => { if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath); }, 5000);
  } else if (data === 'request_edit_file') {
    if (!session.lastHtml) {
      await ctx.answerCallbackQuery({ text: '⚠️ لا توجد ملزمة سابقة لطلب التعديل عليها.', show_alert: true });
      return;
    }
    session.awaitingEdit = true;
    await ctx.answerCallbackQuery();
    await ctx.reply(`
✏️ **طلب تعديل على ملزمة [${session.lastTitle || 'الدرس'}]:**

أرسل التعديل أو التغيير المطلوب الآن في المحادثة، مثل:
• *"إضافة 3 أسئلة كويز اختيار من متعدد"*
• *"تعديل تعريف لغة التحيز وتوضيح الشرح أكثر"*
• *"إضافة قسم جديد وتغيير العنوان"*

وسيقوم البوت بتحديث كود الـ HTML وإعادة إخراج ملف الـ PDF المعدل فوراً!
`, { parse_mode: 'Markdown' });
  } else if (data === 'menu_quiz') {
    await ctx.answerCallbackQuery();
    await showQuizMainMenu(ctx, session);

  // ⚙️ إعدادات الكويز
  } else if (data === 'quiz_settings') {
    await ctx.answerCallbackQuery();
    const settingsKb = new InlineKeyboard()
      .text('🔢 نوع الأسئلة', 'quiz_set_type')
      .text('📊 مستوى الصعوبة', 'quiz_set_difficulty')
      .row()
      .text('🔢 عدد الأسئلة: ' + session.quizSettings.count, 'quiz_set_count')
      .row()
      .text('🔙 رجوع للكويز', 'menu_quiz');
    await ctx.editMessageText(`⚙️ **إعدادات الكويز الحالية:**\n\n• **النوع:** ${getQuizTypeName(session.quizSettings.type)}\n• **الصعوبة:** ${getDifficultyName(session.quizSettings.difficulty)}\n• **العدد:** ${session.quizSettings.count} سؤال`, {
      parse_mode: 'Markdown', reply_markup: settingsKb
    });

  } else if (data === 'quiz_set_type') {
    await ctx.answerCallbackQuery();
    const typeKb = new InlineKeyboard()
      .text('🔢 اختيار من متعدد', 'quiz_type_mcq')
      .row()
      .text('✅❌ صح وغلط', 'quiz_type_truefalse')
      .row()
      .text('📝 أكمل العبارة', 'quiz_type_complete')
      .row()
      .text('🔙 رجوع', 'quiz_settings');
    await ctx.editMessageText('🔢 **اختر نوع أسئلة الكويز:**', { parse_mode: 'Markdown', reply_markup: typeKb });

  } else if (data.startsWith('quiz_type_')) {
    const type = data.replace('quiz_type_', '');
    session.quizSettings.type = type;
    await ctx.answerCallbackQuery({ text: `✅ تم اختيار: ${getQuizTypeName(type)}` });
    // العودة لإعدادات الكويز
    const settingsKb = new InlineKeyboard()
      .text('🔢 نوع الأسئلة', 'quiz_set_type')
      .text('📊 مستوى الصعوبة', 'quiz_set_difficulty')
      .row()
      .text('🔢 عدد الأسئلة: ' + session.quizSettings.count, 'quiz_set_count')
      .row()
      .text('🔙 رجوع للكويز', 'menu_quiz');
    await ctx.editMessageText(`⚙️ **إعدادات الكويز الحالية:**\n\n• **النوع:** ${getQuizTypeName(session.quizSettings.type)}\n• **الصعوبة:** ${getDifficultyName(session.quizSettings.difficulty)}\n• **العدد:** ${session.quizSettings.count} سؤال`, {
      parse_mode: 'Markdown', reply_markup: settingsKb
    });

  } else if (data === 'quiz_set_difficulty') {
    await ctx.answerCallbackQuery();
    const diffKb = new InlineKeyboard()
      .text('🟢 سهل', 'quiz_diff_easy')
      .text('🟡 متوسط', 'quiz_diff_medium')
      .row()
      .text('🔴 صعب (تفكير عليا)', 'quiz_diff_hard')
      .text('🎯 متنوع', 'quiz_diff_mixed')
      .row()
      .text('🔙 رجوع', 'quiz_settings');
    await ctx.editMessageText('📊 **اختر مستوى صعوبة الكويز:**', { parse_mode: 'Markdown', reply_markup: diffKb });

  } else if (data.startsWith('quiz_diff_')) {
    const diff = data.replace('quiz_diff_', '');
    session.quizSettings.difficulty = diff;
    await ctx.answerCallbackQuery({ text: `✅ تم اختيار: ${getDifficultyName(diff)}` });
    const settingsKb = new InlineKeyboard()
      .text('🔢 نوع الأسئلة', 'quiz_set_type')
      .text('📊 مستوى الصعوبة', 'quiz_set_difficulty')
      .row()
      .text('🔢 عدد الأسئلة: ' + session.quizSettings.count, 'quiz_set_count')
      .row()
      .text('🔙 رجوع للكويز', 'menu_quiz');
    await ctx.editMessageText(`⚙️ **إعدادات الكويز الحالية:**\n\n• **النوع:** ${getQuizTypeName(session.quizSettings.type)}\n• **الصعوبة:** ${getDifficultyName(session.quizSettings.difficulty)}\n• **العدد:** ${session.quizSettings.count} سؤال`, {
      parse_mode: 'Markdown', reply_markup: settingsKb
    });

  } else if (data === 'quiz_set_count') {
    await ctx.answerCallbackQuery();
    const countKb = new InlineKeyboard()
      .text('3️⃣ 3 أسئلة', 'quiz_count_3')
      .text('5️⃣ 5 أسئلة', 'quiz_count_5')
      .row()
      .text('🔟 10 أسئلة', 'quiz_count_10')
      .text('1️⃣5️⃣ 15 سؤال', 'quiz_count_15')
      .row()
      .text('2️⃣0️⃣ 20 سؤال', 'quiz_count_20')
      .row()
      .text('🔙 رجوع', 'quiz_settings');
    await ctx.editMessageText('🔢 **اختر عدد أسئلة الكويز:**', { parse_mode: 'Markdown', reply_markup: countKb });

  } else if (data.startsWith('quiz_count_')) {
    const count = parseInt(data.replace('quiz_count_', ''));
    session.quizSettings.count = count;
    await ctx.answerCallbackQuery({ text: `✅ تم اختيار: ${count} سؤال` });
    const settingsKb = new InlineKeyboard()
      .text('🔢 نوع الأسئلة', 'quiz_set_type')
      .text('📊 مستوى الصعوبة', 'quiz_set_difficulty')
      .row()
      .text('🔢 عدد الأسئلة: ' + session.quizSettings.count, 'quiz_set_count')
      .row()
      .text('🔙 رجوع للكويز', 'menu_quiz');
    await ctx.editMessageText(`⚙️ **إعدادات الكويز الحالية:**\n\n• **النوع:** ${getQuizTypeName(session.quizSettings.type)}\n• **الصعوبة:** ${getDifficultyName(session.quizSettings.difficulty)}\n• **العدد:** ${session.quizSettings.count} سؤال`, {
      parse_mode: 'Markdown', reply_markup: settingsKb
    });

  // ⚡ كويز ويب تفاعلي ذاتي التصحيح (HTML)
  } else if (data === 'quiz_html_last') {
    await ctx.answerCallbackQuery({ text: '🌐 جاري تجهيز كويز الويب التفاعلي ذاتي التصحيح...' });
    await handleQuizHtml(ctx, session);

  // ⚡ كويز سريع من آخر درس (Telegram Poll)
  } else if (data === 'quiz_quick_poll') {
    await ctx.answerCallbackQuery({ text: '🧠 جاري توليد الكويز التفاعلي...' });
    await handleQuizPoll(ctx, session);

  // 📋 كويز PDF احترافي من آخر درس
  } else if (data === 'quiz_pdf_last') {
    await ctx.answerCallbackQuery({ text: '📋 جاري تصميم كويز PDF احترافي...' });
    await handleQuizPdf(ctx, session);

  // ✍️ كويز من موضوع جديد
  } else if (data === 'quiz_new_topic') {
    session.awaitingQuizTopic = true;
    await ctx.answerCallbackQuery();
    await safeEditMessageText(ctx, `
✍️ **أرسل النص أو الموضوع المطلوب لإنشاء الكويز:**

يمكنك إرسال:
• 📝 نص الدرس أو المحتوى العلمي كاملاً
• 📌 اسم الموضوع فقط (مثال: "قوانين كيرشوف" أو "التجربة الشعرية")

⚙️ الإعدادات الحالية: ${session.quizSettings.count} سؤال | ${getQuizTypeName(session.quizSettings.type)} | ${getDifficultyName(session.quizSettings.difficulty)}
`, { parse_mode: 'Markdown' });

  // 📄 1. خيار البدء: إنشاء ملزمة شرح A4
  } else if (data === 'start_create_lesson') {
    await ctx.answerCallbackQuery();
    const historyCount = session.lessonHistory?.length || 0;
    const kb = new InlineKeyboard();
    if (historyCount > 0) {
      kb.text(`📚 اختيار من دروسي السابقة (${historyCount})`, 'menu_library_for_lesson').row();
    }
    kb.text('➕ إرسال محتوى جديد للدرس', 'prompt_new_lesson_content').row()
      .text('🔙 القائمة الرئيسية', 'main_menu');

    await safeEditMessageText(ctx, `
📄 **إنشاء ملزمة شرح A4 (معايير البكالوريا 2027):**

تفريغ وتنسيق كامل حتى 10 صفحات مع قسم «حِلّ بإيدك» ومفتاح الإجابات.
يمكنك الاستعانة بدرس سابق أو إرسال محتوى جديد:
`, { parse_mode: 'Markdown', reply_markup: kb });

  // 🧠 2. خيار البدء: تصميم كويز احترافي
  } else if (data === 'start_create_quiz') {
    await ctx.answerCallbackQuery();
    await showQuizMainMenu(ctx, session);

  // 📥 تنبيه إرسال محتوى جديد للدرس
  } else if (data === 'prompt_new_lesson_content') {
    await ctx.answerCallbackQuery();
    await ctx.reply(`
📥 **أرسل المحتوى العلمي للدرس الآن بأي طريقة تناسبك:**

1️⃣ 🖼️ **صورة أو لقطة سبورة (OCR فائق):** التقط أو أرسل صورة للسبورة أو المذكرة.
2️⃣ 📄 **ملف PDF:** أرسل ملف المستند لاستخراجه بالكامل.
3️⃣ 🎙️ **تسجيل صوتي (Voice Note):** سجّل شرح الدرس بصوتك وسيقوم البوت بتفريغه وتنسيقه كاملاً.
4️⃣ 🎥 **رابط يوتيوب:** أرسل رابط المحاضرة لسحب وتنسيق الشرح.
5️⃣ ✍️ **نص مباشر:** اكتب أو الصق الدرس في المحادثة مباشرة.
`, { parse_mode: 'Markdown' });

  // 📚 فتح مكتبة الدروس السابقة
  } else if (data === 'menu_library' || data === 'menu_library_for_lesson' || data === 'quiz_from_history') {
    await ctx.answerCallbackQuery();
    await showLessonLibrary(ctx, session);

  // 📖 اختيار درس محدد من المكتبة
  } else if (data.startsWith('history_item_')) {
    const idx = parseInt(data.replace('history_item_', ''));
    const item = session.lessonHistory[idx];
    if (!item) {
      await ctx.answerCallbackQuery({ text: '⚠️ لم يتم العثور على هذا الدرس.' });
      return;
    }
    await ctx.answerCallbackQuery();
    const itemKb = new InlineKeyboard()
      .text('🌐 كويز ويب ذاتي التصحيح (HTML)', `hist_quiz_html_${idx}`).row()
      .text('📋 كويز PDF احترافي مطبوع', `hist_quiz_pdf_${idx}`).row()
      .text('⚡ كويز تلجرام سريع (Poll)', `hist_quiz_poll_${idx}`).row()
      .text('📄 تصدير ملزمة A4 PDF من هذا الدرس', `hist_pdf_${idx}`).row()
      .text('🔙 رجوع لمكتبة الدروس', 'menu_library');

    await safeEditMessageText(ctx, `
📖 **الدرس المختار:** ${item.title}
⏱️ **تاريخ الحفظ:** ${item.createdAt || 'مؤخراً'}

🎯 **اختر الإجراء المطلوب لهذا الدرس:**
`, { parse_mode: 'Markdown', reply_markup: itemKb });

  } else if (data.startsWith('hist_quiz_html_')) {
    const idx = parseInt(data.replace('hist_quiz_html_', ''));
    const item = session.lessonHistory[idx];
    if (item) {
      await ctx.answerCallbackQuery({ text: '🌐 جاري توليد كويز HTML التفاعلي...' });
      const historySource = extractTextFromHtml(item.html || '').trim() || item.contentText;
      await handleQuizHtml(ctx, session, historySource, item.title);
    }

  } else if (data.startsWith('hist_quiz_pdf_')) {
    const idx = parseInt(data.replace('hist_quiz_pdf_', ''));
    const item = session.lessonHistory[idx];
    if (item) {
      await ctx.answerCallbackQuery({ text: '📋 جاري توليد كويز PDF...' });
      const historySource = extractTextFromHtml(item.html || '').trim() || item.contentText;
      await handleQuizPdf(ctx, session, historySource, item.title);
    }

  } else if (data.startsWith('hist_quiz_poll_')) {
    const idx = parseInt(data.replace('hist_quiz_poll_', ''));
    const item = session.lessonHistory[idx];
    if (item) {
      await ctx.answerCallbackQuery({ text: '⚡ جاري إرسال الكويز التفاعلي...' });
      const historySource = extractTextFromHtml(item.html || '').trim() || item.contentText;
      await handleQuizPoll(ctx, session, historySource, item.title);
    }

  } else if (data.startsWith('hist_pdf_')) {
    const idx = parseInt(data.replace('hist_pdf_', ''));
    const item = session.lessonHistory[idx];
    if (item) {
      await ctx.answerCallbackQuery({ text: '📄 جاري تجهيز ملزمة الـ PDF...' });
      const historySource = extractTextFromHtml(item.html || '').trim() || item.contentText;
      await processAndSendHtml(ctx, { prompt: historySource, sourceType: 'text' });
    }

  }
});

// 🌐 معالج كويز الويب التفاعلي ذاتي التصحيح (HTML)
async function handleQuizHtml(ctx, session, customContentText = null, customTitle = null) {
  const contentText = customContentText || session.lastContentText || extractTextFromHtml(session.lastHtml || '');
  const title = (customTitle || session.lastTitle || 'كويز_المتفوق').replace(/[\\/:*?"<>|]/g, '').trim();

  if (!contentText || contentText.length < 20) {
    await ctx.reply('⚠️ لا يوجد محتوى كافٍ لإنشاء كويز تفاعلي. أرسل درساً أولاً أو استخدم كويز من موضوع جديد.');
    return;
  }

  const htmlQuizCount = 10;
  const statusMsg = await ctx.reply(`🌐 **جاري إنشاء كويز تفاعلي ذاتي التصحيح (HTML) بمعايير البكالوريا 2027...**\n• عدد الأسئلة: ${htmlQuizCount}\n• النوع: اختيار من متعدد مع تصحيح فوري\n• الصعوبة: ${getDifficultyName(session.quizSettings.difficulty)}`, { parse_mode: 'Markdown' });

  try {
    await updateProgress(ctx, statusMsg, 'المرحلة 1 من 2 — تجهيز كويز HTML', 10, 'تم استلام محتوى الدرس، وجاري بناء بنك الأسئلة من المصدر فقط.');
    const htmlCode = await generateSelfGradingHtmlQuiz({
      apiKey: geminiApiKey,
      contentText: contentText,
      modelName: defaultModel,
      count: htmlQuizCount,
      difficulty: session.quizSettings.difficulty,
      quizType: 'mcq',
      lessonTitle: title.replace(/_/g, ' '),
      isPartner: session.isPartner,
      explicitTrack: session.track || 'auto'
    });

    await updateProgress(ctx, statusMsg, 'المرحلة 1 من 2 — مراجعة الكويز', 65, 'تم توليد الأسئلة؛ جاري التأكد من التصحيح الفوري وشريط التقدم قبل الإرسال.');

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const htmlFilename = `المتفوق — كويز تفاعلي — ${title}.html`;
    const htmlPath = path.join(tempDir, htmlFilename);
    fs.writeFileSync(htmlPath, htmlCode, 'utf-8');

    await updateProgress(ctx, statusMsg, 'المرحلة 1 من 2 — اكتملت', 100, 'كويز HTML جاهز. بعد حله يمكنك الانتقال مباشرة إلى المرحلة الثانية المقالية.');
    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}

    await ctx.replyWithDocument(new InputFile(htmlPath, htmlFilename), {
      caption: `
🌐 **كويز «المتفوق» التفاعلي ذاتي التصحيح جاهز!** 🧠

📌 **الدرس:** ${title.replace(/_/g, ' ')}
🧭 **المسار:** ${getTrackBadge(session.track)}
🔢 **عدد الأسئلة:** ${htmlQuizCount} سؤال اختيار من متعدد
📊 **المستوى:** ${getDifficultyName(session.quizSettings.difficulty)}
🎓 **المعايير:** البكالوريا المصرية 2027 (تحليل، استنتاج، فكرة وعكسها)

📱 **طريقة الاستخدام:**
1️⃣ حمّل واحفظ الملف على هاتفك أو جهازك.
2️⃣ افتح الملف في أي متصفح (يعمل بدون إنترنت 100%).
3️⃣ حل الأسئلة واضغط **«🎯 تسليم وتصحيح الكويز»** لتظهر درجتك ونسبتك فوراً مع التفسير العلمي وناتج التعلم لكل سؤال!

🌟 **نجتهد لنوفق** 🌟
`,
      reply_markup: new InlineKeyboard()
        .text('📋 المرحلة 2: كويز مقالي', 'quiz_pdf_last')
        .text('⚡ كويز Telegram Poll', 'quiz_quick_poll')
        .row()
        .text('🔙 القائمة الرئيسية', 'main_menu')
    });

    setTimeout(() => {
      if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
    }, 15000);

  } catch (err) {
    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
    await ctx.reply(`❌ **خطأ أثناء تصميم كويز الـ HTML التفاعلي:**\n\`${publicErrorMessage(err)}\``, { parse_mode: 'Markdown' });
  }
}

// Telegram يفرض 300 حرف للسؤال، و100 حرف لكل اختيار، و200 حرف للتفسير.
function telegramPollText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function prepareTelegramPollQuestion(question) {
  const options = (Array.isArray(question.options) ? question.options : [])
    .slice(0, 10)
    .map(option => telegramPollText(option, 100));
  const correctOptionIndex = Math.min(
    Math.max(Number(question.correctOptionIndex) || 0, 0),
    Math.max(options.length - 1, 0)
  );

  return {
    text: telegramPollText(question.question, 300),
    options,
    correctOptionIndex,
    explanation: telegramPollText(question.explanation, 200)
  };
}

// 🧠 معالج كويز Telegram Poll التفاعلي
async function handleQuizPoll(ctx, session, customContentText = null, customTitle = null) {
  const contentText = customContentText || session.lastContentText || extractTextFromHtml(session.lastHtml || '');
  const title = customTitle || session.lastTitle || 'الموضوع';

  console.log(`🎯 مصدر الكويز التفاعلي: العنوان="${title}" | طول النص=${contentText.length} | معاينة="${contentText.slice(0, 180).replace(/\s+/g, ' ')}"`);

  if (!contentText || contentText.length < 20) {
    await ctx.reply('⚠️ لا يوجد محتوى كافٍ لإنشاء كويز. أرسل درساً أولاً أو استخدم خيار "كويز من موضوع جديد".');
    return;
  }

  const statusMsg = await ctx.reply(`🧠 **جاري توليد ${session.quizSettings.count} سؤال كويز تفاعلي...**\n• المسار: ${getTrackBadge(session.track)}\n• النوع: ${getQuizTypeName(session.quizSettings.type)}\n• الصعوبة: ${getDifficultyName(session.quizSettings.difficulty)}`, { parse_mode: 'Markdown' });

  try {
    const quizItems = await generateInteractiveQuiz({
      apiKey: geminiApiKey,
      contentText: contentText,
      modelName: defaultModel,
      count: session.quizSettings.count,
      difficulty: session.quizSettings.difficulty,
      quizType: session.quizSettings.type,
      explicitTrack: session.track || 'auto'
    });

    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}

    if (!quizItems || quizItems.length === 0) {
      await ctx.reply('⚠️ تعذر توليد أسئلة الكويز. جرب إرسال محتوى أطول أو تغيير الإعدادات.');
      return;
    }

    await ctx.reply(`🧠 **كويز المتفوق — ${title}**\n🧭 **المسار:** ${getTrackBadge(session.track)}\n📊 ${quizItems.length} سؤال | ${getDifficultyName(session.quizSettings.difficulty)}\n\n🎯 أجب على كل سؤال واضغط الإجابة الصحيحة!`, { parse_mode: 'Markdown' });

    // إرسال كل سؤال كـ Telegram Quiz Poll مع احترام حدود Bot API.
    let sentPolls = 0;
    for (let i = 0; i < quizItems.length; i++) {
      const q = quizItems[i];
      try {
        const poll = prepareTelegramPollQuestion(q);
        if (poll.options.length < 2) throw new Error('السؤال لا يحتوي على اختيارين صالحين على الأقل');
        await ctx.api.sendPoll(ctx.chat.id, `${i + 1}/${quizItems.length}. ${poll.text}`, poll.options, {
          type: 'quiz',
          correct_option_id: poll.correctOptionIndex,
          explanation: poll.explanation || undefined,
          is_anonymous: false
        });
        sentPolls++;
        if (i < quizItems.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      } catch (pollErr) {
        console.warn(`تعذر إرسال السؤال ${i + 1}:`, pollErr.message);
      }
    }

    await ctx.reply(`✅ **تم إرسال كويز المتفوق بنجاح! (${sentPolls} من ${quizItems.length} سؤال)**\n\n🌟 نجتهد لنوفق 🌟`, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('🌐 كويز ويب تفاعلي (HTML)', 'quiz_html_last')
        .row()
        .text('📋 تصدير كويز PDF', 'quiz_pdf_last')
        .text('🔄 كويز آخر', 'quiz_quick_poll')
        .row()
        .text('🔙 القائمة الرئيسية', 'main_menu')
    });

  } catch (err) {
    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
    await ctx.reply(`❌ **خطأ أثناء توليد الكويز:**\n\`${publicErrorMessage(err)}\``, { parse_mode: 'Markdown' });
  }
}

// 📋 معالج كويز PDF احترافي
async function handleQuizPdf(ctx, session, customContentText = null, customTitle = null) {
  const contentText = customContentText || session.lastContentText || extractTextFromHtml(session.lastHtml || '');
  const title = customTitle || session.lastTitle || 'كويز المتفوق';

  console.log(`🎯 مصدر كويز PDF: العنوان="${title}" | طول النص=${contentText.length} | معاينة="${contentText.slice(0, 180).replace(/\s+/g, ' ')}"`);

  if (!contentText || contentText.length < 20) {
    await ctx.reply('⚠️ لا يوجد محتوى كافٍ لإنشاء كويز PDF. أرسل درساً أولاً.');
    return;
  }

  const essayCount = 10;
  const statusMsg = await ctx.reply(`📋 **جاري إعداد نسختي كويز PDF مقالي (10 أسئلة)...**
• نسخة مجابة بإجابات نموذجية
• نسخة غير مجابة لمساحة الطالب
• الصعوبة: ${getDifficultyName(session.quizSettings.difficulty)}`, { parse_mode: 'Markdown' });

  try {
    await updateProgress(ctx, statusMsg, 'المرحلة 2 من 2 — بناء الأسئلة المقالية', 15, 'جاري إنشاء أسئلة تحليلية مرتبطة بمحتوى الدرس فقط.');
    let answeredHtml = await generateQuizPdf({
      apiKey: geminiApiKey,
      contentText,
      modelName: defaultModel,
      count: essayCount,
      selectedIdentity: session.identity,
      isPartner: session.isPartner,
      difficulty: session.quizSettings.difficulty,
      lessonTitle: title,
      explicitTrack: session.track || 'auto',
      questionMode: 'essay'
    });

    answeredHtml = processGeneratedHtml(answeredHtml);
    await updateProgress(ctx, statusMsg, 'المرحلة 2 من 2 — تجهيز النسختين', 55, 'تم إنشاء النسخة المجابة؛ جاري استخراج نسخة الطالب وإخفاء مفتاح الإجابة بالكامل.');
    const unansweredHtml = processGeneratedHtml(createUnansweredQuizHtml(answeredHtml));
    const quizTitle = `كويز_المتفوق_مقالي_${title.replace(/[\/:*?"<>|]/g, '')}`;
    const isLandscape = session.identity.includes('Landscape') || session.identity.includes('الصفحتين');
    const answeredBuffer = await renderSafePdf(answeredHtml, isLandscape);
    await updateProgress(ctx, statusMsg, 'المرحلة 2 من 2 — تحويل PDF', 78, 'جاري تحويل النسخة المجابة ونسخة الطالب إلى ملفي PDF منفصلين.');
    const unansweredBuffer = await renderSafePdf(unansweredHtml, isLandscape);

    await updateProgress(ctx, statusMsg, 'المرحلة 2 من 2 — اكتملت', 100, 'تم تجهيز النسخة المجابة والنسخة غير المجابة بنجاح.');
    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}

    await ctx.replyWithDocument(new InputFile(answeredBuffer, `${quizTitle}_مجابة.pdf`), {
      caption: `📋 **النسخة المجابة — كويز «المتفوق»**

📌 الموضوع: ${title.replace(/_/g, ' ')}
📝 10 أسئلة مقالية مع خطوات الحل والإجابات النموذجية

🌟 نجتهد لنوفق 🌟`
    });
    await ctx.replyWithDocument(new InputFile(unansweredBuffer, `${quizTitle}_غير_مجابة.pdf`), {
      caption: `📝 **النسخة غير المجابة — للطالب**

📌 الموضوع: ${title.replace(/_/g, ' ')}
✍️ نفس الأسئلة مع مساحات مخصصة للحل

يمكنك الآن حل الأسئلة ثم مراجعة النسخة المجابة.`,
      reply_markup: new InlineKeyboard()
        .text('🌐 كويز ويب تفاعلي — 10 أسئلة', 'quiz_html_last')
        .row()
        .text('🔄 كويز مقالي آخر', 'quiz_pdf_last')
        .text('🔙 القائمة الرئيسية', 'main_menu')
    });

  } catch (err) {
    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
    await ctx.reply(`❌ **خطأ أثناء تصميم كويز PDF:**\n\`${publicErrorMessage(err)}\``, { parse_mode: 'Markdown' });
  }
}

// 📚 عرض مكتبة الدروس السابقة
async function showLessonLibrary(ctx, session) {
  const history = session.lessonHistory || [];
  if (history.length === 0) {
    const emptyKb = new InlineKeyboard()
      .text('➕ إرسال محتوى درس جديد', 'prompt_new_lesson_content')
      .row()
      .text('🔙 القائمة الرئيسية', 'main_menu');
    const msg = `📚 **مكتبة الدروس السابقة فارغة حالياً.**\nقم بإرسال درسك الأول وسيحفظه البوت تلقائياً هنا لتعود إليه في أي وقت!`;
    if (ctx.callbackQuery) {
      await safeEditMessageText(ctx, msg, { parse_mode: 'Markdown', reply_markup: emptyKb });
    } else {
      await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: emptyKb });
    }
    return;
  }

  const kb = new InlineKeyboard();
  history.forEach((item, idx) => {
    kb.text(`📖 ${idx + 1}. ${item.title.slice(0, 30)}`, `history_item_${idx}`).row();
  });
  kb.text('➕ درس جديد', 'prompt_new_lesson_content')
    .row()
    .text('🔙 القائمة الرئيسية', 'main_menu');

  const text = `
📚 **مكتبة دروسك السابقة (${history.length} درس محفوظ):**

اضغط على أي درس للاختيار بين (عمل كويز تفاعلي HTML، كويز PDF مطبوع، كويز تلجرام، أو إعادة تصدير الملزمة):
`;

  if (ctx.callbackQuery) {
    await safeEditMessageText(ctx, text, { parse_mode: 'Markdown', reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  }
}

// استخراج النص من كود HTML للكويز
function extractTextFromHtml(html) {
  if (!html) return '';
  return html.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000);
}

function reviewGeneratedLesson(html) {
  const text = extractTextFromHtml(html);
  const problems = [];
  if (!/^\s*(<!doctype html|<html)/i.test(html || '')) problems.push('بداية HTML غير صحيحة');
  if (!/<\/html>\s*$/i.test(html || '')) problems.push('نهاية HTML ناقصة');
  if (text.length < 120) problems.push('المحتوى النصي قصير جداً');
  if (!/<div[^>]*class=["'][^"']*pg/i.test(html || '')) problems.push('لا توجد حاويات صفحات A4');
  if (/X{4,}|\[رمز\]|\\sqrt\{\}|\\lambda\s*(?:sqrt|frac)|<\/html>[\s\S]+/i.test(html || '')) problems.push('رموز تعويضية أو LaTeX مشوه');
  if (/```(?:html|css)?/i.test(html || '')) problems.push('بقايا Markdown خارج HTML');
  return { ok: problems.length === 0, problems, textLength: text.length };
}

const progressState = new Map();
async function updateProgress(ctx, statusMsg, stage, percent, detail, force = false) {
  if (!statusMsg) return;
  const key = String(ctx.chat?.id || statusMsg.message_id);
  const now = Date.now();
  const previous = progressState.get(key) || { at: 0, percent: -1 };
  if (!force && now - previous.at < 2500 && percent < 100 && percent - previous.percent < 10) return;
  progressState.set(key, { at: now, percent });
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const text = `⏳ **${stage}**\n[${bar}] ${percent}%\n${detail}`;
  try {
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, text, { parse_mode: 'Markdown' });
  } catch (_) {}
}

// ⚡ 4. محرك المعالجة المباشر وإرسال ملف HTML شرح واحد فقط مع خيارات التعديل
async function processAndSendHtml(ctx, { prompt, sourceType, imageBuffer, imageMimeType, images = [], audioBuffer, audioMimeType, isEdit = false }) {
  if (!hasValidApiKey()) {
    await safeReply(ctx, `⚠️ **تنبيه:** لم يتم إدخال أي مفتاح صالح لـ \`GEMINI_API_KEY\` في ملف \`.env\`.`, { parse_mode: 'Markdown' });
    return;
  }

  const session = getUserSession(ctx.chat.id);
  const totalImages = (images && images.length) || (imageBuffer ? 1 : 0);
  const sourceLabel = totalImages > 1 ? `🖼️ (${totalImages} صور مجمعة ومترابطة)` : sourceType.toUpperCase();

  const statusText = isEdit
    ? `✏️ **جاري تطبيق التعديلات المطلوبة وإعادة تجهيز ملف HTML الشرح...**`
    : `⚡ **جاري تجهيز الملزمة بجودة عالية...**\n• الهوية: ${session.identity}\n• المصدر: ${sourceLabel}`;

  let statusMsg = null;
  try {
    statusMsg = await safeReply(ctx, statusText, { parse_mode: 'Markdown' });
  } catch (e) {
    console.warn('⚠️ فشل إرسال رسالة الحالة المبدئية، متابعة المعالجة:', e.message);
  }

  // 💓 مؤشر النبض المتواصل في تليجرام لإبقاء إشارة "جاري الرفع" نشطة طوال فترة التوليد
  const heartbeatTimer = setInterval(async () => {
    try {
      await ctx.replyWithChatAction('upload_document');
    } catch (_) {}
  }, 4000);

  try {
    await updateProgress(ctx, statusMsg, 'استقبال وتجهيز المصدر', 10, 'تم استلام المحتوى، وجاري تجهيز النصوص والصور للمراجعة.');
    let htmlCode = '';
    let lessonPlan = '';
    if (isEdit && session.lastHtml) {
      // تعديل ملف HTML موجود
      await updateProgress(ctx, statusMsg, 'تحليل التعديل والملف السابق', 25, 'جاري فهم المطلوب والمحافظة على المحتوى الصحيح.');
      htmlCode = await modifyLessonHtml({
        apiKey: geminiApiKey,
        existingHtml: session.lastHtml,
        editInstructions: prompt,
        selectedIdentity: session.identity,
        isPartner: session.isPartner,
        modelName: defaultModel
      });
    } else {
      // تخطيط مستقل قبل توليد أي HTML لتحديد المادة وتوزيع الصفحات من المصدر فقط.
      await updateProgress(ctx, statusMsg, 'بناء مخطط الملزمة', 25, 'جاري تحديد المادة والعناوين وترتيب المفاهيم وتوزيع الصفحات قبل الكتابة.');
      lessonPlan = await createLessonPlan({
        apiKey: geminiApiKey,
        userPrompt: prompt,
        modelName: defaultModel,
        sourceType,
        imageBuffer,
        imageMimeType,
        images,
        audioBuffer,
        audioMimeType
      });
      await updateProgress(ctx, statusMsg, 'مراجعة المخطط', 38, 'تم إعداد مخطط المصدر؛ جاري التحقق من عدم إدخال موضوعات خارجية.');
      // توليد ملف HTML جديد بعد اعتماد المخطط
      await updateProgress(ctx, statusMsg, 'كتابة الملزمة وتوزيع الصفحات', 48, 'جاري صياغة الشرح والأمثلة والتمارين وفق المخطط المعتمد.');
      htmlCode = await generateLessonHtml({
        apiKey: geminiApiKey,
        userPrompt: prompt,
        selectedIdentity: session.identity,
        isPartner: session.isPartner,
        modelName: defaultModel,
        sourceType: sourceType,
        imageBuffer: imageBuffer,
        imageMimeType: imageMimeType,
        images: images,
        audioBuffer: audioBuffer,
        audioMimeType: audioMimeType,
        track: session.track || 'auto',
        lessonPlan
      });
    }

    await updateProgress(ctx, statusMsg, 'تنظيم المحتوى وتصميم الصفحات', 60, 'جاري توزيع الشرح والقوانين والأمثلة ومساحات الحل بدون تزاحم.');
    const quality = reviewGeneratedLesson(htmlCode);
    if (!quality.ok) {
      throw new Error(`فشلت مراجعة الملزمة قبل التحويل: ${quality.problems.join('، ')}`);
    }
    await updateProgress(ctx, statusMsg, 'مراجعة الملزمة', 78, `تم فحص HTML والمعادلات والصفحات — ${quality.textLength} حرفاً علمياً صالحاً.`);

    // استخراج اسم الدرس ديناميكياً لتسمية الملف باسم محتواه
    const lessonTitle = extractLessonTitle(htmlCode, 'ملزمة_المتفوق');
    const generatedLessonText = extractTextFromHtml(htmlCode).trim();
    const quizSourceText = generatedLessonText.length >= 50 ? generatedLessonText : (prompt || '');
    
    // حفظ النسخة في جلسة المستخدم لتسهيل التعديلات والكويزات القادمة
    session.lastHtml = htmlCode;
    session.lastTitle = lessonTitle;
    // مهم: الكويز يجب أن يعتمد على محتوى الملزمة المستخرج من HTML، لا على
    // prompt عام مثل «حلل الصور»، وإلا سيحصل النموذج على مصدر غير علمي.
    session.lastContentText = quizSourceText;
    session.awaitingEdit = false;

    // 📚 حفظ في مكتبة الدروس السابقة (حتى 10 دروس)
    if (!session.lessonHistory) session.lessonHistory = [];
    const historyItem = {
      id: 'lesson_' + Date.now(),
      title: lessonTitle.replace(/_/g, ' '),
      contentText: quizSourceText,
      html: htmlCode,
      createdAt: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    };
    session.lessonHistory = [historyItem, ...session.lessonHistory.filter(l => l.title !== historyItem.title)].slice(0, 10);

    const htmlBuffer = Buffer.from(sanitizeDocumentHtml(htmlCode), 'utf8');
    const htmlDisplayFilename = isEdit
      ? `المتفوق — ${lessonTitle} — معدل.html`
      : `المتفوق — ${lessonTitle}.html`;
    await updateProgress(ctx, statusMsg, 'تجهيز ملف HTML الشرح', 90, 'جاري حفظ ملف HTML المكتفي ذاتياً وإعداده للإرسال.');

    // لوحة مفاتيح تفاعلية مرفقة تحت ملف HTML الشرح
    const editKeyboard = new InlineKeyboard()
      .text('✏️ طلب تعديل على هذا الملف', 'request_edit_file')
      .row()
      .text('🌐 كويز ويب تفاعلي (HTML)', 'quiz_html_last')
      .text('📋 كويز PDF مطبوع', 'quiz_pdf_last')
      .row()
      .url('📢 قناة المتفوق الرسمية', 'https://t.me/+OAYxVF1Uqcs2NmE0')
      .row()
      .text('💻 كود HTML الاحتياطي', 'get_backup_html')
      .text('🔙 القائمة الرئيسية', 'main_menu');

    await updateProgress(ctx, statusMsg, 'اكتمل ملف الشرح', 100, 'تمت المراجعة والتنسيق بنجاح، جاري إرسال الملف.', true);
    if (statusMsg) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
    }
    // 🌐 إرسال ملف HTML الشرح فقط باسم محتواه
    await ctx.replyWithDocument(new InputFile(htmlBuffer, htmlDisplayFilename), {
      caption: `✨ **تم إعداد شرح HTML لدرس «${lessonTitle.replace(/_/g, ' ')}» بنجاح!**\n\n🎨 **الهوية:** ${session.identity}\n⚡ **النظام:** البكالوريا المصرية 2027\n🌐 **النتيجة:** ملف HTML شرح فقط — افتحه في أي متصفح.\n\n👇 يمكنك تعديل الملف أو إنشاء كويز تفاعلي من الأزرار أدناه:`,
      reply_markup: editKeyboard
    });

  } catch (err) {
    console.error('❌ خطأ في معالجة المحتوى:', err);
    if (statusMsg) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
    }
    await safeReply(ctx, `❌ **عذراً، حدث خطأ أثناء إعداد الملزمة:**\n\`${publicErrorMessage(err)}\`\n\n💡 _يرجى إعادة المحاولة أو تجربة صياغة الطلب بشكل آخر._`, { parse_mode: 'Markdown' });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

// 🖼️ مجمع الصور الذكي للألبومات والدفعات المتتالية (Multi-Image Batch Collector)
const photoBatchMap = new Map();

bot.on('message:photo', async (ctx) => {
  const session = getUserSession(ctx.chat.id);
  const text = ctx.message.caption || '';

  // فحص ما إذا كانت الرسالة طلب تعديل على ملزمة سابقة
  if (session.awaitingEdit || (session.lastHtml && /(عدل|تعديل|ضيف|غير|اضف)/i.test(text))) {
    await processAndSendHtml(ctx, { prompt: text || 'تعديل وتحديث الملزمة', sourceType: 'text', isEdit: true });
    return;
  }

  const chatId = ctx.chat.id;
  const mediaGroupId = ctx.message.media_group_id;
  const batchKey = mediaGroupId ? `${chatId}_${mediaGroupId}` : `chat_${chatId}`;

  try {
    const photos = ctx.message.photo;
    const highestResPhoto = photos[photos.length - 1];
    const file = await ctx.api.getFile(highestResPhoto.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    
    const response = await fetchTelegramFile(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    let batch = photoBatchMap.get(batchKey);

    if (batch) {
      // إضافة الصورة الجديدة للدفعة الحالية وتجديد المؤقت
      clearTimeout(batch.timeoutId);
      batch.images.push({ buffer: imageBuffer, mimeType: 'image/jpeg' });
      if (text && !batch.captions.includes(text)) {
        batch.captions.push(text);
      }
      batch.ctx = ctx; // تحديث الـ context لآخر رسالة
      await updateProgress(ctx, batch.statusMsg, 'استلام الصور', Math.min(50, 20 + batch.images.length * 10), `تم استلام ${batch.images.length} صورة؛ جاري انتظار بقية الصور في الألبوم.`);
    } else {
      // بدء دفعة صور جديدة
      const statusMsg = await ctx.reply('🖼️ **جاري استلام الصور وتجميعها قبل التحليل...**');
      batch = {
        images: [{ buffer: imageBuffer, mimeType: 'image/jpeg' }],
        captions: text ? [text] : [],
        ctx: ctx,
        statusMsg,
        timeoutId: null
      };
      photoBatchMap.set(batchKey, batch);
      await updateProgress(ctx, statusMsg, 'استلام الصور', 20, 'تم استلام أول صورة؛ جاري تجميع بقية الصور المرتبطة.');
    }

    // انتظار 2.5 ثانية لتجميع كل الصور المرسلة في ألبوم واحد أو متتابعة
    batch.timeoutId = setTimeout(async () => {
      const currentBatch = photoBatchMap.get(batchKey);
      photoBatchMap.delete(batchKey);

      if (!currentBatch || currentBatch.images.length === 0) return;

      const totalImages = currentBatch.images.length;
      await updateProgress(currentBatch.ctx, currentBatch.statusMsg, 'اكتمال تجميع الصور', 55, `تم تجميع ${totalImages} صورة؛ جاري تحليلها كدرس واحد.`);
      try { await currentBatch.ctx.api.deleteMessage(currentBatch.ctx.chat.id, currentBatch.statusMsg.message_id); } catch (_) {}
      const mergedCaption = currentBatch.captions.filter(Boolean).join(' - ') || 
        'قم بقراءة وفهم وتحليل كافة الصور والصفحات المرفقة معاً كدرس واحد متكامل، واستخراج كافة النصوص والمعادلات والأمثلة بالترتيب، وتوليد ملزمة واحدة شاملة تشمل الشرح المفصل، التطبيقات، وقسم «✍️ حِلّ بإيدك» المخطط ومفتاح الإجابات، وبنك أسئلة متوافق 100% مع البكالوريا 2027.';

      console.log(`📸 معالجة دفعة صور مكتملة (${totalImages} صور) للمستخدم [${chatId}]...`);

      await processAndSendHtml(currentBatch.ctx, {
        prompt: mergedCaption,
        sourceType: totalImages > 1 ? `images_batch_${totalImages}` : 'image',
        images: currentBatch.images
      });
    }, 2500);

  } catch (err) {
    console.error('خطأ في استلام الصورة:', err);
    await ctx.reply(`❌ حدث خطأ أثناء تحميل الصورة: ${publicErrorMessage(err)}`);
  }
});

// 🎤 معالجة التسجيلات الصوتية
bot.on(['message:voice', 'message:audio'], async (ctx) => {
  const statusMsg = await ctx.reply('🎙️ **جاري سحب وتفريغ الصوت الشرحي...**');
  try {
    await updateProgress(ctx, statusMsg, 'استلام التسجيل الصوتي', 10, 'تم استلام التسجيل، وجاري تنزيله من Telegram.');
    const audioObj = ctx.message.voice || ctx.message.audio;
    const file = await ctx.api.getFile(audioObj.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    
    const response = await fetchTelegramFile(fileUrl);
    await updateProgress(ctx, statusMsg, 'تجهيز الصوت للتفريغ', 35, 'تم تنزيل التسجيل، وجاري إرساله لمحرك التفريغ والتحليل.');
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    const mimeType = ctx.message.voice ? 'audio/ogg' : (audioObj.mime_type || 'audio/mp3');
    await updateProgress(ctx, statusMsg, 'اكتمل استلام الصوت', 55, 'تم تجهيز التسجيل؛ جاري بناء الملزمة وتحويلها إلى PDF.');

    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}

    const caption = ctx.message.caption || 'قم بسماع الشرح الصوتي وتفريغه علمياً وتنسيقه في ملزمة A4.';

    await processAndSendHtml(ctx, {
      prompt: caption,
      sourceType: 'audio',
      audioBuffer: audioBuffer,
      audioMimeType: mimeType
    });
  } catch (err) {
    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
    await ctx.reply(`❌ حدث خطأ أثناء تحليل الصوت: ${publicErrorMessage(err)}`);
  }
});

// 🎥 معالجة النصوص وروابط يوتيوب وطلبات التعديل
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const session = getUserSession(ctx.chat.id);

  // 🔘 معالجة أزرار الكيبورد الدائم أسفل الشات
  if (text === '📄 عمل ملزمة شرح') {
    await ctx.reply(`
📄 **عمل ملزمة شرح A4 احترافية:**

أرسل الآن أي محتوى:
• ✍️ نصوص ومذكرات دراسية
• 📸 صورة أو عدة صور سبورة/كتاب معاً (ألبوم)
• 🎙️ تسجيل صوتي لشرح المعلم
• 🎥 رابط فيديو يوتيوب
• 📄 مستند PDF أو ملف HTML

وسيقوم البوت فوراً بتفريغ الشرح وتنسيقه حتى 10 صفحات مع خريطة مفاهيم وقسم «✍️ حِلّ بإيدك» المخطط ومفتاح الإجابات بدقة علمية 100%!
`, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '🧠 كويز احترافي') {
    await showQuizMainMenu(ctx, session);
    return;
  }

  if (text === '🧭 مسارات البكالوريا') {
    await showTracksMenu(ctx, session);
    return;
  }

  if (text === '📚 مكتبة دروسي') {
    await showLessonLibrary(ctx, session);
    return;
  }

  if (text === '📢 قناة المتفوق') {
    await ctx.reply(`
📢 **قناة «المتفوق» الرسمية لسلسلة الشروحات والملازم:**
🔗 [اضغط هنا للانضمام إلى القناة](https://t.me/+OAYxVF1Uqcs2NmE0)
`, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().url('📢 انضم للقناة الآن 🌟', 'https://t.me/+OAYxVF1Uqcs2NmE0')
    });
    return;
  }

  if (text === '🎨 الهوية البصرية') {
    await showIdentityMenu(ctx);
    return;
  }

  // فحص ما إذا كان المستخدم يرسل نص لإنشاء كويز منه
  if (session.awaitingQuizTopic) {
    session.awaitingQuizTopic = false;
    session.lastContentText = text;
    session.lastTitle = text.slice(0, 30).replace(/[\\/:*?"<>|]/g, '').trim() || 'كويز_جديد';

    const quizModeKb = new InlineKeyboard()
      .text('⚡ كويز تفاعلي (Telegram Poll)', 'quiz_quick_poll')
      .row()
      .text('📋 كويز PDF احترافي', 'quiz_pdf_last')
      .row()
      .text('🔙 رجوع', 'menu_quiz');

    await ctx.reply(`✅ **تم حفظ الموضوع!**\n\n📌 **الموضوع:** ${text.slice(0, 50)}\n⚙️ ${session.quizSettings.count} سؤال | ${getQuizTypeName(session.quizSettings.type)} | ${getDifficultyName(session.quizSettings.difficulty)}\n\n**اختر نوع الكويز:**`, {
      parse_mode: 'Markdown',
      reply_markup: quizModeKb
    });
    return;
  }

  // فحص ما إذا كان المستخدم يطلب تعديلاً على ملزمة سابقة
  if (session.awaitingEdit || (session.lastHtml && /(عدل|تعديل|ضيف|اضاف|غير|حذ|صلح|اضف)/i.test(text))) {
    await processAndSendHtml(ctx, {
      prompt: text,
      sourceType: 'text',
      isEdit: true
    });
    return;
  }

  // 🌐 فحص ما إذا كان المستخدم أرسل كود HTML مباشر
  if (text.trim().startsWith('<!DOCTYPE html') || text.trim().startsWith('<html') || (text.includes('<head>') && text.includes('<body>') && text.includes('</html>'))) {
    const statusMsg = await ctx.reply('🌐 **تم التعرف على كود HTML مباشر! جاري معالجته في الذاكرة وإعداد ملف الـ PDF...**');
    try {
      const processedHtml = processGeneratedHtml(sanitizeDocumentHtml(text));
      const lessonTitle = extractLessonTitle(processedHtml, 'ملزمة_HTML_مباشرة');

      session.lastHtml = processedHtml;
      session.lastTitle = lessonTitle;
      session.lastContentText = extractTextFromHtml(processedHtml);
      session.awaitingEdit = false;

      // حفظ في المكتبة
      if (!session.lessonHistory) session.lessonHistory = [];
      session.lessonHistory.unshift({
        id: 'lesson_' + Date.now(),
        title: lessonTitle.replace(/_/g, ' '),
        contentText: session.lastContentText,
        html: processedHtml,
        createdAt: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      });
      if (session.lessonHistory.length > 10) session.lessonHistory.pop();

      const pdfFilename = `${lessonTitle}.pdf`;
      const isLandscape = session.identity.includes('Landscape') || session.identity.includes('الصفحتين');
      const pdfBuffer = await renderSafePdf(processedHtml, isLandscape);

      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}

      await ctx.replyWithDocument(new InputFile(pdfBuffer, pdfFilename), {
        caption: `
✅ **تم استيراد ومعالجة كود الـ HTML بنجاح!** 📄

📌 **العنوان:** ${lessonTitle.replace(/_/g, ' ')}
🧭 **المسار:** ${getTrackBadge(session.track)}
🎨 **الهوية:** ${session.identity}

💡 **يمكنك الآن:**
• الضغط على **«✏️ طلب تعديل»** لتعديل أي جزء في كود الـ HTML.
• توليد كويز تفاعلي ذاتي التصحيح أو كويز PDF من هذا المحتوى فوراً!
`,
        reply_markup: new InlineKeyboard()
          .text('✏️ طلب تعديل على هذا الملف', 'request_edit_file')
          .text('💻 تحميل كود HTML', 'get_backup_html')
          .row()
          .text('🌐 كويز ويب تفاعلي (HTML)', 'quiz_html_last')
          .text('📋 كويز PDF مطبوع', 'quiz_pdf_last')
          .row()
          .url('📢 قناة المتفوق الرسمية', 'https://t.me/+OAYxVF1Uqcs2NmE0')
          .row()
          .text('🔙 القائمة الرئيسية', 'main_menu')
      });

    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
      await ctx.reply(`❌ **خطأ أثناء معالجة كود الـ HTML:**\n\`${publicErrorMessage(err)}\``, { parse_mode: 'Markdown' });
    }
    return;
  }

  const isYoutube = /(youtube\.com|youtu\.be)/i.test(text);

  if (isYoutube) {
    const statusMsg = await ctx.reply('🎥 **جاري جلب وتفريغ محاضرة يوتيوب واستخراج النص...**');
    try {
      const extracted = await extractYoutubeTranscript(text);
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
      
      await ctx.reply(`✅ **تم استخراج تفريغ الفيديو بنجاح!** (${extracted.qualityRating})`);
      
      await processAndSendHtml(ctx, {
        prompt: extracted.content,
        sourceType: 'youtube'
      });
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
      await ctx.reply(`❌ ${publicErrorMessage(err)}`);
    }
  } else {
    await processAndSendHtml(ctx, {
      prompt: text,
      sourceType: 'text'
    });
  }
});

// 📄 معالجة المستندات (PDF و HTML مباشرة)
bot.on('message:document', async (ctx) => {
  const doc = ctx.message.document;
  const fileName = (doc.file_name || '').toLowerCase();
  const mimeType = (doc.mime_type || '').toLowerCase();
  const caption = ctx.message.caption || '';
  const session = getUserSession(ctx.chat.id);

  // 1. معالجة ملفات الـ HTML المرفوعة مباشرة
  if (fileName.endsWith('.html') || fileName.endsWith('.htm') || mimeType.includes('html')) {
    const statusMsg = await ctx.reply('🌐 **جاري قراءة واستيراد ملف الـ HTML مباشرة...**');
    try {
      await updateProgress(ctx, statusMsg, 'استلام ملف HTML', 10, 'تم استلام الملف، وجاري تنزيله بأمان من Telegram.');
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const response = await fetchTelegramFile(fileUrl);
      await updateProgress(ctx, statusMsg, 'قراءة ملف HTML', 35, 'تم تنزيل الملف، وجاري قراءة المحتوى وتنظيف HTML قبل العرض.');
      const rawHtml = await response.text();

      // إذا كان مع الملف كابشن يحتوي على طلب تعديل
      if (caption && caption.trim().length > 0) {
        await updateProgress(ctx, statusMsg, 'تحضير التعديل', 55, 'تمت قراءة الملف، وجاري تمرير طلب التعديل إلى محرك المعالجة.');
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
        session.lastHtml = rawHtml;
        session.lastTitle = doc.file_name.replace(/\.(html|htm)$/i, '');
        await processAndSendHtml(ctx, {
          prompt: caption,
          sourceType: 'html_edit',
          isEdit: true
        });
        return;
      }

      // معالجة الـ HTML وتجهيزه وإعادته كملف شرح HTML فقط
      await updateProgress(ctx, statusMsg, 'تنظيف وتجهيز HTML', 60, 'جاري تعقيم المحتوى وحفظه في مكتبة الدروس.');
      const processedHtml = processGeneratedHtml(sanitizeDocumentHtml(rawHtml));
      const lessonTitle = extractLessonTitle(processedHtml, doc.file_name.replace(/\.(html|htm)$/i, ''));

      session.lastHtml = processedHtml;
      session.lastTitle = lessonTitle;
      session.lastContentText = extractTextFromHtml(processedHtml);
      session.awaitingEdit = false;

      // حفظ في مكتبة الدروس
      if (!session.lessonHistory) session.lessonHistory = [];
      session.lessonHistory.unshift({
        id: 'lesson_' + Date.now(),
        title: lessonTitle.replace(/_/g, ' '),
        contentText: session.lastContentText,
        html: processedHtml,
        createdAt: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      });
      if (session.lessonHistory.length > 10) session.lessonHistory.pop();

      const htmlFilename = `${lessonTitle}.html`;
      const htmlBuffer = Buffer.from(processedHtml, 'utf8');
      await updateProgress(ctx, statusMsg, 'تجهيز ملف HTML الشرح', 85, 'جاري حفظ ملف الشرح HTML وإرساله لك.');

      await updateProgress(ctx, statusMsg, 'اكتمل تجهيز ملف HTML', 100, 'تمت القراءة والتنظيف والتنسيق بنجاح.');
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
      await ctx.replyWithDocument(new InputFile(htmlBuffer, htmlFilename), {
        caption: `
🌐 **تم قراءة واستيراد ملف الـ HTML الشرح بنجاح!** 📄

📌 **الملف:** ${lessonTitle.replace(/_/g, ' ')}
🧭 **المسار:** ${getTrackBadge(session.track)}
🎨 **الهوية:** ${session.identity}
🌐 **النتيجة:** ملف HTML شرح فقط — افتحه في أي متصفح.

💡 **خيارات الملف المتاحة:**
• أرسل أي تعديل تريده في الشات وسيطبقه البوت فوراً على هذا الـ HTML.
• اضغط على **«🌐 كويز ويب تفاعلي»** لإنشاء كويز ذاتي التصحيح من محتوى هذا الملف.
`,
        reply_markup: new InlineKeyboard()
          .text('✏️ طلب تعديل على هذا الملف', 'request_edit_file')
          .text('💻 تحميل كود HTML المعدل', 'get_backup_html')
          .row()
          .text('🌐 كويز ويب تفاعلي (HTML)', 'quiz_html_last')
          .text('📋 كويز PDF مطبوع', 'quiz_pdf_last')
          .row()
          .url('📢 قناة المتفوق الرسمية', 'https://t.me/+OAYxVF1Uqcs2NmE0')
          .row()
          .text('🔙 القائمة الرئيسية', 'main_menu')
      });

    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
      await ctx.reply(`❌ **خطأ أثناء قراءة ملف الـ HTML:**\n\`${publicErrorMessage(err)}\``, { parse_mode: 'Markdown' });
    }
    return;
  }

  // 2. معالجة ملفات الـ PDF
  if (fileName.endsWith('.pdf') || mimeType.includes('pdf')) {
    const statusMsg = await ctx.reply('📄 **جاري قراءة واستخراج مستند الـ PDF...**');
    try {
      await updateProgress(ctx, statusMsg, 'استلام ملف PDF', 10, 'تم استلام الملف، وجاري تنزيله بأمان من Telegram.');
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const response = await fetchTelegramFile(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await updateProgress(ctx, statusMsg, 'استخراج نص PDF', 45, 'تم تنزيل الملف، وجاري استخراج النص والصفحات للتحليل.');
      const extracted = await extractPdfText(buffer);
      await updateProgress(ctx, statusMsg, 'اكتمل استخراج PDF', 65, `تم استخراج ${extracted.numpages} صفحة؛ جاري بدء تجهيز الملزمة.`);
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}

      await ctx.reply(`✅ **تم استخراج ${extracted.numpages} صفحة من الـ PDF!** (${extracted.qualityRating})`);

      await processAndSendHtml(ctx, {
        prompt: caption ? `${caption}\n\nالمحتوى المستخرج:\n${extracted.content}` : extracted.content,
        sourceType: 'pdf'
      });
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (_) {}
      await ctx.reply(`❌ ${publicErrorMessage(err)}`);
    }
    return;
  }

  await ctx.reply('⚠️ يرجى إرسال ملفات بصيغة **HTML (.html)** أو **PDF (.pdf)** فقط.');
});

// 🌐 HTTP Health Check Server لـ Railway (مطلوب لضمان استمرار التشغيل)
const PORT = process.env.PORT || 3000;
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/' || req.url === '/ready') {
    const isReady = botReady && hasValidApiKey();
    res.writeHead(isReady ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: isReady ? 'ok' : 'starting',
      ready: isReady,
      bot: '@Studymate21_bot',
      service: 'Al-Motafawiq Bot — البكالوريا المصرية 2027',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});
healthServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Health Check Server يعمل على المنفذ ${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    flushSessions();
    healthServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

// 🚀 تشغيل البوت
console.log('🚀 جاري تشغيل بوت «المتفوق» الذكي (إصدار PDF واحد باسم الدرس + ميزة التعديل)...');
bot.start({
  onStart: (botInfo) => {
    botReady = true;
    console.log(`✅ تم تشغيل البوت بنجاح تحت اسم: @${botInfo.username}`);
  }
}).catch((err) => {
  botReady = false;
  if (err.message && err.message.includes('DUMMY_TOKEN')) {
    console.log('⚠️ البوت جاهز، لكن يتطلب إدخال TELEGRAM_BOT_TOKEN في ملف .env ليتمكن من الاتصال بتليجرام.');
  } else {
    console.error('خطأ تشغيل البوت:', err);
  }
});
