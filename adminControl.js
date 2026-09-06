import dotenv from 'dotenv';
dotenv.config();

/**
 * البوت مفتوح للاستخدام العام.
 * متغيرات ALLOWED_USER_IDS وADMIN_IDS القديمة لم تعد تمنع المستخدمين من الدخول.
 */
export function isUserAllowed(ctx) {
  return Boolean(ctx?.from || ctx?.chat);
}
