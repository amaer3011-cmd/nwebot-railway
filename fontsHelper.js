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

  // 3. تضمين الخطوط ومكتبة المعادلات KaTeX بالهيد إن لم تكن موجودة
  if (!cleanHtml.includes('fonts.googleapis.com') && cleanHtml.includes('<head>')) {
    cleanHtml = cleanHtml.replace('<head>', `<head>\n${GOOGLE_FONTS_IMPORTS}`);
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
