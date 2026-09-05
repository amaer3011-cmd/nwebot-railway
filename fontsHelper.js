/**
 * مساعد الخطوط والتنسيقات الرقمية المدمجة ودعم المعادلات الرياضية KaTeX
 */

export const GOOGLE_FONTS_IMPORTS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lalezar&family=Cairo:wght@600;700;800;900&family=Aref+Ruqaa:wght@700&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" onload="if(window.renderMathInElement) renderMathInElement(document.body);"></script>
`;

// قواعد مشتركة لضبط إخراج PDF بصرف النظر عن الهوية البصرية التي اختارها النموذج.
// الهدف: تدفق طبيعي للمحتوى، منع انقسام البطاقات والجداول، وإبقاء الفوتر أسفل الصفحة.
export const PRINT_LAYOUT_OVERRIDES = `
<style id="motafawiq-print-layout">
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; }
  body { overflow-x: hidden; }
  .pg {
    min-height: 296mm !important;
    height: 296mm !important;
    justify-content: flex-start !important;
    overflow: hidden !important;
  }
  .pg > .footer { margin-top: auto !important; }
  .content-wrapper { width: 100% !important; max-width: 100% !important; }
  .section-header, .section-title, .card-simple, .card-def, .card-warn,
  .card-trick, .card-gold, .concept-map, .question-card, .answer-key,
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
  .formula-box .katex-display { margin: 2mm 0 !important; overflow-x: auto; overflow-y: hidden; }
  .formula-box .formula-title { font-weight: 800; color: #2B3445; margin-bottom: 1mm; }
</style>
`;

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

  // 3. تضمين الخطوط ومكتبة المعادلات KaTeX بالهيد إن لم تكن موجودة
  if (!cleanHtml.includes('fonts.googleapis.com') && cleanHtml.includes('<head>')) {
    cleanHtml = cleanHtml.replace('<head>', `<head>\n${GOOGLE_FONTS_IMPORTS}`);
  }

  if (cleanHtml.includes('<head>') && !cleanHtml.includes('motafawiq-print-layout')) {
    cleanHtml = cleanHtml.replace('</head>', `${PRINT_LAYOUT_OVERRIDES}\n</head>`);
  }

  // 4. زر الطباعة العائم ورابط القناة الرسمي
  if (!cleanHtml.includes('window.print()')) {
    const printToolbar = `
    <div class="toolbar" style="position:fixed;top:15px;left:15px;z-index:9999;background:rgba(26,26,46,0.94);padding:8px 16px;border-radius:30px;box-shadow:0 8px 20px rgba(0,0,0,0.3);backdrop-filter:blur(6px);display:flex;align-items:center;gap:12px;">
      <span style="color:#FFF;font-family:sans-serif;font-size:0.85rem;font-weight:bold;">🌟 سلسلة «المتفوق»</span>
      <a href="https://t.me/+OAYxVF1Uqcs2NmE0" target="_blank" style="background:#2563EB;color:#FFF;text-decoration:none;padding:5px 14px;font-weight:bold;border-radius:20px;font-family:sans-serif;font-size:0.8rem;display:flex;align-items:center;gap:5px;">📢 انضم للقناة</a>
      <button onclick="window.print()" style="background:linear-gradient(135deg,#F6CF3F,#F7941D);color:#1A1A2E;border:none;padding:6px 16px;font-weight:bold;border-radius:20px;cursor:pointer;font-family:sans-serif;box-shadow:0 3px 8px rgba(0,0,0,0.2);">⬇️ تحميل PDF / طباعة</button>
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

  return cleanHtml;
}
