const { test } = require('node:test');
const assert = require('node:assert/strict');
const { correctAnswers, isCurrentLevel, fillCorrectAnswer, installAnswerAssistance } = require('../wanikani-review-priority.user.js');

const kanji = {
  id: 1, type: 'Kanji', primary_reading_type: 'onyomi',
  meanings: [{ kind: 'alternative', text: 'Sun' }, { kind: 'primary', text: 'Day' }, { kind: 'blocked', text: 'Moon' }],
  readings: [{ kind: 'primary', type: 'kunyomi', text: 'ひ' }, { kind: 'primary', type: 'onyomi', text: 'にち' },
    { kind: 'alternative', type: 'onyomi', text: 'じつ' }, { kind: 'allowed', type: 'kunyomi', text: 'か' },
    { kind: 'warning', type: 'onyomi', text: 'げつ' }]
};
const metadata = new Map([[1, { level: 10 }], [2, { level: 9 }]]);

test('answers prefer primary and exclude blocked/warning entries and incorrect kanji reading types', () => {
  assert.deepEqual(correctAnswers(kanji, 'meaning'), ['Day', 'Sun']);
  assert.deepEqual(correctAnswers(kanji, 'reading'), ['にち', 'じつ', 'か']);
  assert.deepEqual(correctAnswers({ type: 'Vocabulary', readings: [{ kind: 'primary', text: 'おはよう' }] }, 'reading'), ['おはよう']);
  assert.deepEqual(correctAnswers({ type: 'KanaVocabulary', readings: [{ kind: 'primary', text: 'おはよう' }] }, 'reading'), []);
  assert.deepEqual(correctAnswers(null, 'meaning'), []);
  assert.deepEqual(correctAnswers(kanji, 'anything'), []);
});

function controllerFixture(action = 'fail') {
  const events = [];
  const c = {
    currentSubject: kanji, currentQuestionType: 'reading', inputEnabled: true, submitting: false,
    inputTarget: { value: 'wrong', dispatchEvent(e) { events.push(e); }, focus() {}, setSelectionRange() {} },
    answerChecker: { evaluate(args) { assert.equal(this, c.answerChecker); assert.equal(args.item, c.currentSubject); return c.result; } },
    result: { action, message: { type: 'itemInfoException', text: 'Original message' } },
    shakeForm() { this.shakes = (this.shakes || 0) + 1; },
    async submitAnswer() {}, clearException() { this.cleared = true; }, events
  };
  return c;
}

test('current-level failures become native retries, including vocabulary; ordinary errors stay failures', () => {
  for (const type of ['Radical', 'Kanji', 'Vocabulary', 'KanaVocabulary']) {
    const c = controllerFixture(); c.currentSubject = { ...kanji, type }; c.nextPending = true;
    let revealed;
    installAnswerAssistance(c, metadata, 10, { onWrong: (s, q) => { revealed = [s, q]; } });
    const result = c.answerChecker.evaluate({ item: c.currentSubject, questionType: 'reading' });
    assert.equal(result.action, 'retry'); assert.equal(result.message.type, 'answerException');
    assert.equal(c.result.action, 'fail'); assert.equal(c.nextPending, false);
    assert.deepEqual(revealed, [c.currentSubject, 'reading']);
  }
  const c = controllerFixture(); c.currentSubject = { ...kanji, id: 2 }; let revealed = false;
  installAnswerAssistance(c, metadata, 10, { onWrong() { revealed = true; } });
  assert.equal(c.answerChecker.evaluate({ item: c.currentSubject, questionType: 'meaning' }), c.result);
  assert.equal(revealed, true);
});

test('native passes (including synonyms) and native retry messages are preserved', () => {
  for (const action of ['pass', 'retry']) {
    const c = controllerFixture(action); let count = 0;
    installAnswerAssistance(c, metadata, 10, { onWrong() { count++; } });
    assert.equal(c.answerChecker.evaluate({ item: kanji, questionType: 'meaning' }), c.result);
    assert.equal(count, action === 'retry' ? 1 : 0);
  }
});

test('unknown levels are never protected or eligible for answer filling', () => {
  assert.equal(isCurrentLevel({ id: 999 }, metadata, 10), false);
  assert.equal(isCurrentLevel({ id: 1 }, metadata, 9), false);
  const c = controllerFixture(); c.currentSubject = { ...kanji, id: 999 };
  installAnswerAssistance(c, metadata, 10);
  assert.equal(c.answerChecker.evaluate({ item: c.currentSubject, questionType: 'reading' }).action, 'fail');
});

test('cheat fills the correct question answer, fires input, and never submits', () => {
  const c = controllerFixture(); c.submitAnswer = () => assert.fail('Must not auto-submit');
  assert.equal(fillCorrectAnswer(c, metadata, 10), true);
  assert.equal(c.inputTarget.value, 'にち'); assert.equal(c.inputChars, 'にち'); assert.equal(c.cleared, true);
  assert.equal(c.events[0].type, 'input'); assert.equal(c.events[0].bubbles, true);
  c.currentQuestionType = 'meaning';
  assert.equal(fillCorrectAnswer(c, metadata, 10), true); assert.equal(c.inputTarget.value, 'Day');
});

test('cheat refuses other levels, pending or answered questions, and disabled input', () => {
  const c = controllerFixture();
  for (const change of [() => { c.currentSubject = { ...kanji, id: 2 }; }, () => { c.inputEnabled = false; },
    () => { c.submitting = true; }, () => { c.inputTarget.disabled = true; }, () => { c.inputTarget.readOnly = true; }]) {
    c.currentSubject = kanji; c.inputEnabled = true; c.submitting = false; c.inputTarget.disabled = false; c.inputTarget.readOnly = false;
    change(); assert.equal(fillCorrectAnswer(c, metadata, 10), false); assert.equal(c.inputTarget.value, 'wrong');
  }
});

test('native early validation shakes and reveals, then leaves the input editable', async () => {
  const c = controllerFixture(); let count = 0;
  c.submitAnswer = async function () { this.submitting = true; this.inputEnabled = false; this.shakeForm(); };
  installAnswerAssistance(c, metadata, 10, { onWrong() { count++; } });
  await c.submitAnswer();
  assert.equal(c.shakes, 1); assert.equal(count, 1); assert.equal(c.inputEnabled, true); assert.equal(c.submitting, false);
  c.inputTarget.value = ''; await c.submitAnswer(); assert.equal(count, 1);
});

test('cleanup restores only our own hooks', () => {
  const c = controllerFixture(); const original = { ...c }; const evaluate = c.answerChecker.evaluate;
  const restore = installAnswerAssistance(c, metadata, 10);
  restore(); restore();
  assert.equal(c.answerChecker.evaluate, evaluate); assert.equal(c.submitAnswer, original.submitAnswer); assert.equal(c.shakeForm, original.shakeForm);
  const restoreAgain = installAnswerAssistance(c, metadata, 10);
  const newer = () => ({ action: 'pass' }); c.answerChecker.evaluate = newer;
  restoreAgain(); assert.equal(c.answerChecker.evaluate, newer);
});
