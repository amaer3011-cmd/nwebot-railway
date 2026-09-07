/**
 * مساعد الخطوط والتنسيقات الرقمية المدمجة ودعم المعادلات الرياضية KaTeX
 */

export const GOOGLE_FONTS_IMPORTS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Aref+Ruqaa:wght@700&family=Cairo:wght@600;700;800;900&family=Lalezar&family=Noto+Sans+Arabic:wght@400;500;600;700;800&family=Poppins:wght@500;600;700;800&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" onload="if(window.renderMathInElement) renderMathInElement(document.body);"></script>
`;

const REQUIRED_TYPOGRAPHY_LINK = '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&family=Lalezar&family=Noto+Sans+Arabic:wght@400;500;600;700;800&family=Poppins:wght@500;600;700;800&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">';
const KATEX_BOOTSTRAP = `<script id="motafawiq-katex-bootstrap">window.addEventListener('load',function(){setTimeout(function(){if(window.renderMathInElement){renderMathInElement(document.body,{delimiters:[{left:'\\\\[',right:'\\\\]',display:true},{left:'\\\\(',right:'\\\\)',display:false}],throwOnError:false});}},0);});</script>`;

// قواعد مشتركة لضبط إخراج PDF بصرف النظر عن الهوية البصرية التي اختارها النموذج.
// الهدف: تدفق طبيعي للمحتوى، منع انقسام البطاقات والجداول، وإبقاء الفوتر أسفل الصفحة.
export const PRINT_LAYOUT_OVERRIDES = `
<style id="motafawiq-print-layout">
	  @page { size: A4 portrait; margin: 0; }
		  html, body { margin: 0 !important; padding: 0 !important; }
		  html { background: #fff !important; }
	  body {
	    overflow-x: hidden;
	    font-family: 'Noto Sans Arabic', 'Tajawal', 'Cairo', sans-serif !important;
	    font-size: 12.2pt !important;
	    line-height: 1.78 !important;
	    color: #243247;
	    text-rendering: optimizeLegibility;
	  }
	  h1, h2, h3, h4, .section-title, .answer-key-title, .quiz-badge {
	    font-family: 'Cairo', 'Noto Sans Arabic', sans-serif !important;
	    font-weight: 800 !important;
	    line-height: 1.35 !important;
	  }
	  p, li, td, th { line-height: 1.78 !important; }
	  p { margin: 0 0 2.4mm !important; }
	  ul, ol { padding-inline-start: 7mm !important; margin: 1.5mm 0 2.5mm !important; }
	  .en, .english, [dir="ltr"] { font-family: 'Poppins', 'Cairo', sans-serif !important; }
  .pg {
	    box-sizing: border-box !important;
	    width: 210mm !important;
	    min-height: 297mm !important;
	    height: auto !important;
	    max-height: none !important;
    justify-content: flex-start !important;
	    overflow: hidden !important;
	    margin: 0 !important;
	    border-radius: 0 !important;
	    box-shadow: none !important;
	    break-after: page !important;
	    page-break-after: always !important;
	  }
	  .pg:last-of-type { break-after: auto !important; page-break-after: auto !important; }
  .pg > .footer { margin-top: auto !important; }
	  .content-wrapper { width: 100% !important; max-width: 100% !important; }
	  .content-wrapper > * { max-width: 100% !important; }
  .section-header, .section-title, .card-simple, .card-def, .card-warn,
	  .card-trick, .card-gold, .concept-map, .question-card, .question-item, .q-card, .quiz-card, .answer-key,
  table, tr, img { break-inside: avoid !important; page-break-inside: avoid !important; }
  .section-header, .section-title { break-after: avoid !important; page-break-after: avoid !important; }
  p { orphans: 3; widows: 3; }
  img { max-width: 100%; height: auto; }
  table.custom-table { table-layout: fixed; }
  .formula-box {
    margin: 3mm 0 !important;
    padding: 3mm 5mm !important;
    border: 2px solid #EC275F !important;
    border-radius: 10px !important;
    background: #FFF7FA !important;
    text-align: center !important;
    break-inside: avoid !important;
  }
  .formula-box .katex-display { margin: 3mm 0 4mm !important; padding-bottom: 2mm !important; overflow-x: auto; overflow-y: hidden; }
  .formula-box .formula-title { font-weight: 800; color: #2B3445; margin-bottom: 2mm; }
  .formula-box + *, table + *, .katex-display + * { margin-top: 4mm !important; }
	  table td, table th { padding: 2.5mm 3mm !important; vertical-align: middle; }
	  .question-card, .question-item, .q-card, .quiz-card {
	    border-radius: 10px !important;
	    padding: 4mm !important;
	    margin: 0 0 4mm !important;
	    break-inside: avoid !important;
	  }
	  .option, .option-card, .opt-label {
	    display: block !important;
	    padding: 2.5mm 3.5mm !important;
	    margin: 1.5mm 0 !important;
	    line-height: 1.65 !important;
	  }
	  .mcq-option, .options-list { display: block !important; line-height: 1.65 !important; }
	  .answer-key { line-height: 1.65 !important; }
	  .workspace-area {
	    min-height: 32mm !important;
    margin: 4mm 0 6mm !important;
    padding: 3mm !important;
    border: 1px dashed #94A3B8 !important;
	    background: repeating-linear-gradient(to bottom, transparent 0, transparent 8mm, #CBD5E1 8.2mm, transparent 8.5mm) !important;
	    break-inside: avoid !important;
	  }
	  .answer-key { break-before: auto !important; page-break-before: auto !important; }
	  @media screen {
	    body { background: #eef2f7 !important; }
	    .pg { margin: 10px auto !important; border-radius: 18px !important; box-shadow: 0 10px 25px rgba(0,0,0,.12) !important; }
	  }
</style>
`;

function arabizeVisibleLabels(html) {
  const replacements = [
    [/\bDownload PDF\b/gi, 'تحميل الملف'], [/\bPDF\b/gi, 'ملف مطبوع'],
    [/\bQuestions\b/gi, 'أسئلة'], [/\bQuestion\b/gi, 'سؤال'],
    [/\bAnswers\b/gi, 'الإجابات'], [/\bAnswer\b/gi, 'إجابة'],
    [/\bExplanation\b/gi, 'التعليل'], [/\bScore\b/gi, 'النتيجة'],
    [/\bSubmit\b/gi, 'تسليم'], [/\bReset\b/gi, 'إعادة المحاولة'],
    [/\bDifficulty\b/gi, 'الصعوبة'], [/\bSource\b/gi, 'المصدر'],
    [/\bLearning Outcome\b/gi, 'ناتج التعلم'], [/\bAnalysis\b/gi, 'تحليل'],
    [/\bInference\b/gi, 'استنتاج'], [/\bApplication\b/gi, 'تطبيق'],
    [/\bUnderstanding\b/gi, 'فهم'], [/\bTrue\s*\/\s*False\b/gi, 'صواب أو خطأ'],
    [/\bMCQ\b/gi, 'اختيار من متعدد'], [/\bThanawiyah\b/gi, 'الثانوية العامة']
  ];
  return replacements.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), html);
}

/**
 * تنظيف وحظر أي نصوص تمهيدية أو ختامية من الـ AI لضمان مخرج HTML نقي 100% مع دعم المعادلات ورابط القناة
 */
export function processGeneratedHtml(htmlCode) {
  let cleanHtml = htmlCode.trim();

  // 1. استخراج كود الـ HTML النقي فقط والمحصور بين <!DOCTYPE html> و </html>
  const htmlMatch = cleanHtml.match(/(<!DOCTYPE\s+html[\s\S]*?<\/html>|<html[\s\S]*?<\/html>)/i);
  if (htmlMatch) {
    cleanHtml = htmlMatch[1].trim();
  } else {
    // إزالة وسوم ماركداون الشائعة إن لم يكتمل التطابق
    cleanHtml = cleanHtml
      .replace(/^[\s\S]*?```html\s*/i, '')
      .replace(/^[\s\S]*?```\s*/i, '')
      .replace(/\s*```[\s\S]*$/, '');
  }

  // 2. ضمان عدم وجود أي نصوص خارج الوسوم الرئيسية
  cleanHtml = cleanHtml.replace(/^[^<]+<!DOCTYPE/i, '<!DOCTYPE');
  cleanHtml = cleanHtml.replace(/<\/html>[\s\S]*$/i, '</html>');

  // تحويل الصيغة الشائعة التي يرسلها النموذج ($...$) إلى صيغة KaTeX inline.
  // كما نعالج \text{...} حتى لا تظهر ككلمة خام داخل ملف PDF.
  cleanHtml = cleanHtml.replace(/\$([^$\n]+)\$/g, (_, expression) => `\\(${expression}\\)`);
  cleanHtml = cleanHtml.replace(/\\text\{([^{}]+)\}/g, '\\mathrm{$1}');
  cleanHtml = cleanHtml
    .replace(/\bX{4,}\b/g, '')
    .replace(/\[رمز\]/g, '')
    // توحيد المسافة بين الرقم والوحدة دون المساس بالأرقام العشرية.
    .replace(/(\d)\s+(m\/s(?:\^?2)?|m|s|kg|N|J|W|Hz|ثواني|ثانية|متر|سم|كجم)\b/gi, '$1 $2');
  // إزالة بادئات OCR الغريبة حول أوامر KaTeX مع الإبقاء على الأمر القياسي.
  cleanHtml = cleanHtml
    .replace(/\\lambda\s*(?:sqrt|\\sqrt)\s*/gi, '\\sqrt')
    .replace(/\\lambda\s*(?:frac|\\frac)\s*/gi, '\\frac')
    .replace(/\\Stheta/gi, '\\theta')
    .replace(/\b(?:Sis|SS)\s*(?=\\(?:sqrt|frac|vec|hat))/g, '')
    .replace(/ولا تنسو الصلاة علي النبي/g, 'ولا تنسوا الصلاة على النبي');
  // تصحيح نمط OCR الشائع الذي يستبدل الجذر بالحرف v في القوانين.
  cleanHtml = cleanHtml
    .replace(/\b[vV]\s*\(\s*2\s*([a-zA-Z])\s*([a-zA-Z])\s*\)/g, '\\sqrt{2$1$2}')
    .replace(/\b[vV]\s*\(\s*([^()]+\^2\s*\+\s*[^()]+\^2)\s*\)/g, '\\sqrt{$1}')
    .replace(/t\s*=\s*[vV]\s*\(\s*2\s*([^()]+)\/\s*([^()]+)\s*\)/g, 't = \\sqrt{\\frac{2$1}{$2}}')
    .replace(/\\sqrt\{\}\s*\(([^()]+)\)/g, '\\sqrt{$1}')
    .replace(/u_f\s*=\s*\\sqrt\{\}\s*\\?\{([^()]+)\)/gi, 'u_f = \\sqrt{$1}')
    .replace(/\bt\s*=\s*[vV]\s*\(\s*2d\s*\/\s*g\s*\)/gi, 't = \\sqrt{\\frac{2d}{g}}');

  // 3. تضمين الخطوط ومكتبة المعادلات KaTeX بالهيد إن لم تكن موجودة
  if (!cleanHtml.includes('fonts.googleapis.com') && cleanHtml.includes('<head>')) {
    cleanHtml = cleanHtml.replace('<head>', `<head>\n${GOOGLE_FONTS_IMPORTS}`);
  }

  // قد يضيف النموذج رابط خطوط قديماً؛ وجود Google Fonts وحده لا يكفي.
  if (cleanHtml.includes('<head>') && !cleanHtml.includes('Noto+Sans+Arabic')) {
    cleanHtml = cleanHtml.replace('</head>', `${REQUIRED_TYPOGRAPHY_LINK}\n</head>`);
  }

  if (cleanHtml.includes('<head>') && !cleanHtml.includes('katex.min.css')) {
    cleanHtml = cleanHtml.replace('</head>', `${GOOGLE_FONTS_IMPORTS}\n</head>`);
  }

  // بعض المخرجات تحتوي على delimiters مكسورة مثل $\(...\)$ داخل onload.
  // نلغي هذا الاستدعاء ونضيف تهيئة واحدة صحيحة بعد تحميل مكتبة KaTeX.
  cleanHtml = cleanHtml.replace(/\s+onload="[^"]*renderMathInElement[^\"]*"/gi, '');
  if (!cleanHtml.includes('motafawiq-katex-bootstrap')) {
    cleanHtml = cleanHtml.replace('</body>', `${KATEX_BOOTSTRAP}\n</body>`);
  }

  if (cleanHtml.includes('<head>') && !cleanHtml.includes('motafawiq-print-layout')) {
    cleanHtml = cleanHtml.replace('</head>', `${PRINT_LAYOUT_OVERRIDES}\n</head>`);
  }

  // 4. زر الطباعة العائم ورابط القناة الرسمي
  if (!/class=["'][^"']*(?:dl-btn|motafawiq-print-btn)/i.test(cleanHtml)) {
    const printToolbar = `
    <div class="toolbar" style="position:fixed;top:15px;left:15px;z-index:9999;background:rgba(26,26,46,0.94);padding:8px 16px;border-radius:30px;box-shadow:0 8px 20px rgba(0,0,0,0.3);backdrop-filter:blur(6px);display:flex;align-items:center;gap:12px;">
      <span style="color:#FFF;font-family:sans-serif;font-size:0.85rem;font-weight:bold;">🌟 سلسلة «المتفوق»</span>
      <a href="https://t.me/+OAYxVF1Uqcs2NmE0" target="_blank" style="background:#2563EB;color:#FFF;text-decoration:none;padding:5px 14px;font-weight:bold;border-radius:20px;font-family:sans-serif;font-size:0.8rem;display:flex;align-items:center;gap:5px;">📢 انضم للقناة</a>
      <button type="button" class="motafawiq-print-btn" style="background:linear-gradient(135deg,#F6CF3F,#F7941D);color:#1A1A2E;border:none;padding:6px 16px;font-weight:bold;border-radius:20px;cursor:pointer;font-family:sans-serif;box-shadow:0 3px 8px rgba(0,0,0,0.2);">⬇️ تحميل PDF / طباعة</button>
    </div>
    <style>
      @media print {
        .toolbar { display: none !important; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      }
    </style>
    `;
    cleanHtml = cleanHtml.replace('</body>', `${printToolbar}\n</body>`);
  }

  return arabizeVisibleLabels(cleanHtml);
}
