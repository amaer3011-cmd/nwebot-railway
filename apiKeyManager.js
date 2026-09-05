/**
 * 🔑 مدير ومجمّع مفاتيح Google Gemini API الذكي
 * يدعم حتى 7 مفاتيح أو أكثر مع التدوير التلقائي الفوري وتخطي أي مفتاح يصل للحد (429 Quota Exceeded)
 */

export function getApiKeyPool(providedKey = null) {
  const keysSet = new Set();

  // 1. قراءة قائمة المفاتيح المفصولة بفواصل
  const envKeysList = (process.env.GEMINI_API_KEYS || '').split(',');
  for (const k of envKeysList) {
    const trimmed = k.trim();
    if (trimmed && !trimmed.includes('your_gemini_api_key_here')) {
      keysSet.add(trimmed);
    }
  }

  // 2. قراءة المفتاح الأساسي الفردي
  const singleKey = (process.env.GEMINI_API_KEY || '').trim();
  if (singleKey && !singleKey.includes('your_gemini_api_key_here')) {
    keysSet.add(singleKey);
  }

  // 3. قراءة المفاتيح المرقمة من 1 إلى 7 (وحتى 10)
  for (let i = 1; i <= 10; i++) {
    const numberedKey = (process.env[`GEMINI_API_KEY_${i}`] || '').trim();
    if (numberedKey && !numberedKey.includes('your_gemini_api_key_here')) {
      keysSet.add(numberedKey);
    }
  }

  // 4. إضافة المفتاح الممرر إن وُجد
  if (providedKey && typeof providedKey === 'string') {
    const trimmed = providedKey.trim();
    if (trimmed && !trimmed.includes('your_gemini_api_key_here')) {
      keysSet.add(trimmed);
    }
  }

  const result = Array.from(keysSet);
  return result;
}

export function hasValidApiKey() {
  const pool = getApiKeyPool();
  return pool.length > 0;
}

export function getPrimaryApiKey() {
  const pool = getApiKeyPool();
  return pool.length > 0 ? pool[0] : '';
}
