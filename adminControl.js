import dotenv from 'dotenv';
dotenv.config();

/**
 * فحص ما إذا كان المستخدم مصرحًا له باستعمال البوت
 */
export function isUserAllowed(ctx) {
  const allowedConfig = process.env.ALLOWED_USER_IDS || process.env.ADMIN_IDS;
  const requireAuth = String(process.env.REQUIRE_AUTH ?? 'true').toLowerCase() !== 'false';

  // الوضع الآمن الافتراضي يرفض الاستخدام الجماعي عند غياب القائمة.
  if (!allowedConfig || allowedConfig.trim() === '') {
    return !requireAuth;
  }

  const userId = String(ctx.from?.id || '');
  const username = String(ctx.from?.username || '').toLowerCase();

  const allowedList = allowedConfig.split(',').map(item => item.trim().toLowerCase());

  return allowedList.includes(userId) || (username && allowedList.includes(`@${username}`) || allowedList.includes(username));
}
