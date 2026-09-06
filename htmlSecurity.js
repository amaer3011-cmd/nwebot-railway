import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'html', 'head', 'body', 'meta', 'title', 'link', 'style', 'main', 'section',
  'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 'small', 'blockquote', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'img', 'a', 'button'
];

const ALLOWED_ATTRIBUTES = {
  '*': ['id', 'class', 'dir', 'lang', 'title', 'role', 'aria-label'],
  html: ['lang', 'dir'],
  meta: ['charset', 'name', 'content', 'viewport'],
  link: ['rel', 'href', 'type'],
  style: ['media'],
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  button: ['type']
};

/** Removes executable HTML features while preserving the document used by the PDF renderer. */
export function sanitizeDocumentHtml(html) {
  if (typeof html !== 'string') throw new TypeError('HTML يجب أن يكون نصاً');
  const sanitized = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    parseStyleAttributes: false,
    allowVulnerableTags: true,
    exclusiveFilter: (frame) => {
      const tag = String(frame.tag?.name || '').toLowerCase();
      return ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'base'].includes(tag);
    }
  });
  return sanitized.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, css, close) =>
    `${open}${css.replace(/@import|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding/gi, '')}${close}`
  );
}

export function publicErrorMessage(error) {
  const message = String(error?.message || 'حدث خطأ غير متوقع').replace(/[\r\n`]/g, ' ').trim();
  if (!message || message.length > 180) return 'تعذر إكمال العملية حالياً. حاول مرة أخرى لاحقاً.';
  return message;
}
