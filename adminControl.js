import dotenv from 'dotenv';
dotenv.config();

/**
 * فحص ما إذا كان المستخدم مصرحًا له باستعمال البوت
 */
export function isUserAllowed(ctx) {
  const allowedConfig = process.env.ALLOWED_USER_IDS || process.env.ADMIN_IDS;
  
  // إذا لم يتم تحديد قائمة معينة، يكون البوت متاحاً للجميع تلقائياً
  if (!allowedConfig || allowedConfig.trim() === '') {
    return true;
  }

  const userId = String(ctx.from?.id || '');
  const username = String(ctx.from?.username || '').toLowerCase();

  const allowedList = allowedConfig.split(',').map(item => item.trim().toLowerCase());

  return allowedList.includes(userId) || (username && allowedList.includes(`@${username}`) || allowedList.includes(username));
}
