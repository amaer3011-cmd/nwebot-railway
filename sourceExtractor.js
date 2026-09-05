import { YoutubeTranscript } from 'youtube-transcript';
import pdfParse from 'pdf-parse';

/**
 * استخراج تفريغ الفيديو من رابط يوتيوب
 */
export async function extractYoutubeTranscript(url) {
  try {
    let transcriptItems = [];
    try {
      transcriptItems = await YoutubeTranscript.fetchTranscript(url, { lang: 'ar' });
    } catch (_) {
      transcriptItems = await YoutubeTranscript.fetchTranscript(url);
    }

    if (!transcriptItems || transcriptItems.length === 0) {
      throw new Error('لم يتم العثور على تفريغ نصي (Transcript) متاح لهذا الفيديو.');
    }

    const fullText = transcriptItems.map(item => item.text).join(' ');
    return {
      type: 'youtube',
      content: fullText,
      itemCount: transcriptItems.length,
      qualityRating: '🟠 دقة متوسطة-عالية (يعتمد على جودة التفريغ الصوتي التلقائي)'
    };
  } catch (err) {
    throw new Error(`تعذر استخراج التفريغ النصي من فيديو يوتيوب: ${err.message}`);
  }
}

/**
 * استخراج النصوص من ملف PDF
 */
export async function extractPdfText(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    if (!data.text || data.text.trim().length === 0) {
      throw new Error('الملف لا يحتوي على نصوص قابلة للقراءة (قد يكون PDF عبارة عن صور مصورة).');
    }
    return {
      type: 'pdf',
      content: data.text.trim(),
      numpages: data.numpages,
      qualityRating: '🟢 دقة فائقة (مستند PDF رقمي مباشر)'
    };
  } catch (err) {
    throw new Error(`تعذر قراءة ملف الـ PDF: ${err.message}`);
  }
}

/**
 * تقييم ومقارنة مصادر المحتوى العلمي وإفادة المعلم بالأضمن
 */
export function getSourceQualityAdvisor() {
  return `
📊 **دليل كفاءة ودقة المصادر (تقييم الذكاء الاصطناعي 🧠):**

1️⃣ 🏆 **الملفات النصية المباشرة (Text):**
   - **التقييم:** 🟢 الأضمن والأعلى دقة (10/10)
   - **المميزات:** يمنح النموذج قدرة 100% على الصياغة العلمية الدقيقة وإنشاء كويزات بمستويات تفكير عليا.

2️⃣ 📄 **ملفات الـ PDF المستندات:**
   - **التقييم:** 🟢 دقة عالية جداً (9/10)
   - **المميزات:** يتم تحليل الجداول والعناوين بشكل ممتاز ومباشر.

3️⃣ 🖼️ **الصور ولقطات الشاشة (OCR Images):**
   - **التقييم:** 🟢 دقة عالية (8.5/10)
   - **المميزات:** قدرة بصرية فائقة من Gemini على قراءة السبورة والكروت المطبوعة.

4️⃣ 🎙️ **الملاحظات الصوتية والبصمات (Voice Notes):**
   - **التقييم:** 🟢 دقة عالية جداً (8.5/10)
   - **المميزات:** تحليل مباشر لصوت المعلم وشرحه الصوتي وتفريغه بدقة في ملزمة.

5️⃣ 🎥 **روابط يوتيوب (YouTube Transcripts):**
   - **التقييم:** 🟡 دقة متوسطة إلى عالية (7.5/10)
   - **المميزات:** تصفية كلام المحاضر واستخراج الشرح، لكن يعتمد على مدى دقة الترجمة التلقائية للفيديو.
`;
}
