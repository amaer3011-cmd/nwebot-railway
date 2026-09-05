import puppeteer from 'puppeteer';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

let sharedBrowser = null;
let isLaunching = false;

/**
 * يحاول إيجاد مسار Chromium المثبت على السيرفر (Railway/Linux) أو يعود لـ Puppeteer المدمج
 */
function getChromiumExecutable() {
  // متغير بيئة مخصص (يمكن ضبطه في Railway Variables)
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;

  // البحث عبر which على Linux/Railway
  try {
    const result = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (result && existsSync(result)) return result;
  } catch (_) {}

  // مسارات شائعة على Linux
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return null; // سيستخدم Puppeteer Chromium المدمج
}

/**
 * جلب نسخة متصفح سريعة ومُحسنة في الذاكرة مع إعادة التشغيل التلقائي
 */
async function getBrowser() {
  if (sharedBrowser && sharedBrowser.connected) {
    return sharedBrowser;
  }

  if (isLaunching) {
    while (isLaunching) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
  }

  isLaunching = true;
  try {
    // محاولة إيجاد Chromium المثبت على السيرفر
    let executablePath;
    try {
      const which = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
      if (which) executablePath = which;
    } catch (_) {}

    const launchOptions = {
      headless: true,
      executablePath: executablePath || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--font-render-hinting=none',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-extensions',
        '--disable-web-security',
        '--memory-pressure-off'
      ]
    };

    console.log(`🌐 تشغيل Puppeteer${executablePath ? ` باستخدام: ${executablePath}` : ' (Chromium المدمج)'}`);
    sharedBrowser = await puppeteer.launch(launchOptions);

    sharedBrowser.on('disconnected', () => {
      console.warn('⚠️ تم فصل متصفح Puppeteer، سيتم إعادة تشغيله تلقائياً عند الطلب القادم.');
      sharedBrowser = null;
    });

    return sharedBrowser;
  } finally {
    isLaunching = false;
  }
}

/**
 * ⚡ تحويل مباشر من كود HTML إلى PDF Buffer في الذاكرة بسرعة فائقة دون الحاجة للقرص
 */
export async function renderHtmlDirectlyToPdf(htmlString, isLandscape = false) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setContent(htmlString, {
      waitUntil: 'load',
      timeout: 45000
    });

    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      if (window.renderMathInElement) {
        window.renderMathInElement(document.body, {
          delimiters: [
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false
        });
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    await page.emulateMediaType('print');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: isLandscape,
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm'
      },
      preferCSSPageSize: true
    });

    return Buffer.from(pdfBuffer);
  } catch (err) {
    console.error('خطأ تحويل PDF في الذاكرة:', err);
    throw new Error(`تعذر تحويل الـ HTML إلى PDF: ${err.message}`);
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * تحويل ملف HTML إلى ملف PDF احترافي مكون من عدة صفحات A4 (حتى 10 صفحات)
 */
export async function convertHtmlToPdf(htmlFilePath, outputPdfPath, isLandscape = false) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    
    const fileUrl = `file://${path.resolve(htmlFilePath)}`;

    await page.goto(fileUrl, {
      waitUntil: 'load',
      timeout: 60000
    });

    await page.emulateMediaType('print');

    await page.pdf({
      path: outputPdfPath,
      format: 'A4',
      landscape: isLandscape,
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm'
      },
      preferCSSPageSize: true
    });

    return outputPdfPath;
  } catch (err) {
    console.error('خطأ تحويل PDF:', err);
    throw new Error(`تعذر تحويل الـ HTML إلى PDF: ${err.message}`);
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

process.on('exit', () => {
  if (sharedBrowser) sharedBrowser.close().catch(() => {});
});
