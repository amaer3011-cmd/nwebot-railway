/**
 * كتالوج الهويات البصرية المعتمدة لسلسلة «المتفوق»
 * محدّث بدعم مساحة «حل بإيدك» المخططة ومفتاح الإجابات وشروط الدقة العلمية 100%
 */

export const DESIGN_CATALOG = {

  // 1. الورقة الملونة 🎀 (الرسمية المعتمدة)
  '🎀 الورقة الملونة': `
:root {
  --pink: #EC275F;
  --orange: #F7941D;
  --teal: #178F94;
  --navy: #2B3445;
  --yellow: #FFE938;
  --paper: #FCFCF9;
  --bg: #F3F6C3;
  --ink: #22303C;
  --card-bg-1: #E9F7F5;
  --card-bg-2: #FFF9E6;
  --card-bg-warn: #FFEBEF;
}

* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

body {
  background: var(--bg);
  font-family: 'Cairo', sans-serif;
  color: var(--ink);
  direction: rtl;
  margin: 0;
  padding: 0;
  line-height: 1.8;
  -webkit-font-smoothing: antialiased;
}

.pg {
  width: 210mm;
  height: 296mm;
  background: var(--paper);
  border: 3.5px solid var(--teal);
  border-radius: 18px;
  padding: 7.5mm 10.5mm;
  position: relative;
  overflow: hidden;
  box-shadow: 0 10px 25px rgba(0,0,0,0.12);
  break-after: page;
  break-inside: avoid;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.pg:last-of-type {
  break-after: auto;
  page-break-after: auto;
}

.watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-30deg);
  font-family: 'Lalezar', cursive;
  font-size: 3.2rem;
  color: rgba(23, 143, 148, 0.05);
  white-space: nowrap;
  pointer-events: none;
  z-index: 0;
  text-align: center;
  line-height: 1.4;
  width: 100%;
}

.content-wrapper {
  position: relative;
  z-index: 1;
}

.partner-bar {
  background: linear-gradient(90deg, var(--navy), #1D2636);
  color: #FFF;
  border-radius: 8px;
  padding: 3px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3.5mm;
  border: 1px solid var(--yellow);
}

.partner-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 700;
}

.partner-badge {
  background: var(--pink);
  color: #FFF;
  padding: 1px 8px;
  border-radius: 4px;
  font-family: 'Lalezar', cursive;
  font-size: 0.85rem;
}

.hd {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2.5px dashed var(--teal);
  padding-bottom: 2mm;
  margin-bottom: 3mm;
}

.hd .tt {
  font-family: 'Lalezar', cursive;
  background: var(--pink);
  color: #FFF;
  padding: 3px 18px;
  border-radius: 10px;
  transform: rotate(-1deg);
  font-size: 1.45rem;
  box-shadow: 2.5px 2.5px 0 var(--navy);
}

.hd .sub-tag {
  background: var(--orange);
  color: #FFF;
  font-family: 'Lalezar', cursive;
  padding: 2px 10px;
  border-radius: 6px;
  font-size: 0.88rem;
  margin-right: 6px;
}

.page-badge {
  background: var(--teal);
  color: #FFF;
  font-family: 'Lalezar', cursive;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3mm;
  margin-bottom: 2mm;
}

.section-title {
  font-family: 'Lalezar', cursive;
  font-size: 1.2rem;
  color: #FFF;
  background: var(--navy);
  padding: 2.5px 13px;
  border-radius: 8px;
  display: inline-block;
  box-shadow: 2px 2px 0 var(--teal);
}

.card-simple {
  background: var(--card-bg-1);
  border-right: 5px solid var(--teal);
  border-radius: 8px;
  padding: 3mm 5mm;
  margin-bottom: 3mm;
  font-size: 0.86rem;
  line-height: 1.75;
}

.card-def {
  background: var(--card-bg-2);
  border-right: 5px solid var(--orange);
  border-radius: 8px;
  padding: 3mm 5mm;
  margin-bottom: 3mm;
  font-size: 0.86rem;
  line-height: 1.75;
}

.card-gold {
  background: var(--pink);
  color: #FFFFFF;
  font-family: 'Lalezar', cursive;
  font-size: 1.08rem;
  padding: 2.5mm 4.5mm;
  text-align: center;
  border-radius: 8px;
  margin-bottom: 3mm;
  box-shadow: 0 3px 0 var(--navy);
}

.card-warn {
  background: var(--card-bg-warn);
  border-right: 5px solid var(--pink);
  border-radius: 8px;
  padding: 3mm 5mm;
  margin-bottom: 3mm;
  font-size: 0.84rem;
  line-height: 1.7;
}

.card-trick {
  background: #F4F0FF;
  border-right: 5px solid #8E44AD;
  border-radius: 8px;
  padding: 3mm 5mm;
  margin-bottom: 3mm;
  font-size: 0.84rem;
  line-height: 1.7;
}

/* ✍️ مساحة قسم «حل بإيدك» المخططة واسعة لكتابة الطالب */
.workspace-area {
  border: 2px dashed var(--teal);
  background: #FFFFFF;
  border-radius: 10px;
  min-height: 32mm;
  margin: 3mm 0;
  position: relative;
  padding: 3mm 4mm;
  background-image: repeating-linear-gradient(transparent, transparent 7mm, rgba(23,143,148,0.12) 7.5mm);
}

.workspace-area::before {
  content: "✍️ مساحة خطتك وحلك باليد (حل المسألة أولاً قبل مراجعة الإجابة بالأسفل):";
  font-size: 0.78rem;
  color: var(--teal);
  font-weight: 800;
  display: block;
  margin-bottom: 2mm;
}

/* 🎯 مفتاح الإجابات النموذجية في أسفل قسم التمارين */
.answer-key {
  background: #F4F6F8;
  border: 1.5px solid var(--navy);
  border-radius: 8px;
  padding: 3mm 5mm;
  margin-top: 3.5mm;
  font-size: 0.82rem;
}

.answer-key-title {
  font-family: 'Lalezar', cursive;
  color: var(--pink);
  font-size: 0.98rem;
  border-bottom: 1.5px dashed var(--navy);
  padding-bottom: 2px;
  margin-bottom: 3px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.words-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
  margin: 2.5mm 0;
}

.word-item {
  background: #FFF;
  border: 1.5px solid var(--teal);
  border-radius: 6px;
  padding: 3px 4px;
  text-align: center;
  font-size: 0.81rem;
  font-weight: 700;
}

.word-item span.en {
  display: block;
  color: var(--pink);
  font-family: 'Poppins', sans-serif;
  font-weight: 800;
  direction: ltr;
  font-size: 0.83rem;
}

.word-item span.ar {
  color: var(--navy);
  font-size: 0.77rem;
}

table.custom-table {
  width: 100%;
  border-collapse: collapse;
  margin: 2.5mm 0;
  font-size: 0.82rem;
}

table.custom-table th {
  background: var(--teal);
  color: #FFFFFF;
  font-family: 'Lalezar', cursive;
  padding: 5.5px;
  font-size: 0.91rem;
  border: 1px solid var(--teal);
}

table.custom-table td {
  border: 1px solid #D1E7E7;
  padding: 5.5px 7px;
  background: #FFFFFF;
  text-align: center;
  font-weight: 700;
}

table.custom-table tr:nth-child(even) td {
  background: #F9FCFC;
}

.en {
  font-family: 'Poppins', sans-serif;
  direction: ltr;
  display: inline-block;
  font-weight: 700;
}

.footer {
  border-top: 2px solid var(--teal);
  padding-top: 2mm;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: 'Aref Ruqaa', serif;
  color: var(--navy);
  font-size: 0.98rem;
}

.footer .salawat {
  color: var(--pink);
  font-size: 1.08rem;
}

.footer .sig {
  font-family: 'Poppins', sans-serif;
  font-weight: 700;
  font-size: 0.78rem;
  color: var(--teal);
  direction: ltr;
}
`,

  // 2. الورق الأبيض — النظام العالمي
  '📖 الورق الأبيض — النظام العالمي': `
:root {
  --paper: #FFFFFF;
  --paper2: #FAF8F3;
  --ink: #1A1A2E;
  --ink2: #5A5A6E;
  --blue: #1E3A5F;
  --gold: #B8860B;
  --red: #B3261E;
  --green: #1E6B4F;
  --line: #E8E4DA;
  --line2: #D8D4C8;
}

* { box-sizing: border-box; }

body {
  background: #EAEAEA;
  font-family: 'Cairo', sans-serif;
  color: var(--ink);
  direction: rtl;
  margin: 0;
  padding: 0;
  line-height: 1.75;
}

.pg {
  width: 210mm;
  height: 296mm;
  background: var(--paper);
  position: relative;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0,0,0,0.1);
  padding: 8mm 11mm;
  break-after: page;
  break-inside: avoid;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.workspace-area {
  border: 2px dashed var(--blue);
  background: #FFFFFF;
  border-radius: 8px;
  min-height: 32mm;
  margin: 3mm 0;
  padding: 3mm 4mm;
  background-image: repeating-linear-gradient(transparent, transparent 7mm, rgba(30,58,95,0.1) 7.5mm);
}

.workspace-area::before {
  content: "✍️ مساحة خطتك وحلك باليد (حل المسألة أولاً قبل مراجعة الإجابة بالأسفل):";
  font-size: 0.78rem;
  color: var(--blue);
  font-weight: 800;
  display: block;
  margin-bottom: 2mm;
}

.answer-key {
  background: #F4F6F8;
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  padding: 3mm 5mm;
  margin-top: 3.5mm;
  font-size: 0.82rem;
}

.footer {
  border-top: 1px solid var(--line2);
  padding-top: 2mm;
  display: flex;
  justify-content: space-between;
  font-family: 'Aref Ruqaa', serif;
  font-size: 1.05rem;
  color: var(--ink2);
}
`
};
