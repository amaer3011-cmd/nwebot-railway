import fs from 'fs';
import path from 'path';

const sessionFile = process.env.SESSION_FILE || path.resolve(process.cwd(), 'data', 'sessions.json');
const sessions = new Map();
let saveTimer = null;

function defaultSession() {
  return {
    identity: '🎀 الورقة الملونة',
    track: 'auto',
    isPartner: true,
    lastHtml: null,
    lastTitle: null,
    lastContentText: null,
    awaitingEdit: false,
    awaitingQuizTopic: false,
    lessonHistory: [],
    quizSettings: { count: 5, type: 'mcq', difficulty: 'mixed' }
  };
}

function loadSessions() {
  try {
    if (!fs.existsSync(sessionFile)) return;
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    for (const [chatId, session] of Object.entries(data)) {
      sessions.set(String(chatId), { ...defaultSession(), ...session, quizSettings: { ...defaultSession().quizSettings, ...(session.quizSettings || {}) } });
    }
  } catch (error) {
    console.warn('تعذر تحميل جلسات المستخدمين، سيبدأ التخزين من جديد:', error.message);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      const serialized = Object.fromEntries(sessions.entries());
      const tempFile = `${sessionFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(serialized), 'utf8');
      fs.renameSync(tempFile, sessionFile);
    } catch (error) {
      console.error('تعذر حفظ جلسات المستخدمين:', error.message);
    }
  }, 250);
  saveTimer.unref?.();
}

loadSessions();

export function getUserSession(chatId) {
  const key = String(chatId);
  if (!sessions.has(key)) sessions.set(key, defaultSession());
  const session = sessions.get(key);
  if (!session.lessonHistory) session.lessonHistory = [];
  if (!session.track) session.track = 'auto';
  return session;
}

export function markSessionsDirty() {
  scheduleSave();
}

export function flushSessions() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    const tempFile = `${sessionFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(Object.fromEntries(sessions.entries())), 'utf8');
    fs.renameSync(tempFile, sessionFile);
  } catch (error) {
    console.error('تعذر حفظ الجلسات عند الإغلاق:', error.message);
  }
}
