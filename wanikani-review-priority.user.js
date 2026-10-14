// ==UserScript==
// @name         WaniKani Review Priority for iOS
// @namespace    https://github.com/WattW/wanikani-ios
// @version      1.1.0
// @description  Priority reviews, current-level mistake protection and answer fill, plus correct-answer reveal.
// @author       WattW
// @license      MIT
// @match        https://www.wanikani.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// @homepageURL  https://github.com/WattW/wanikani-ios
// @supportURL   https://github.com/WattW/wanikani-ios/issues
// @downloadURL  https://raw.githubusercontent.com/WattW/wanikani-ios/main/wanikani-review-priority.user.js
// @updateURL    https://raw.githubusercontent.com/WattW/wanikani-ios/main/wanikani-review-priority.meta.js
// ==/UserScript==

(() => {
  'use strict';

  const GROUPS = ['Current-level radicals', 'Current-level kanji', 'Remaining radicals', 'Remaining kanji', 'All vocabulary'];

  function validLevel(value) {
    const level = Number(value);
    return Number.isInteger(level) && level >= 1 && level <= 60 ? level : null;
  }

  function priority(item, level) {
    const type = String(item.subject_category || item.type || '').toLowerCase().replace(/[_\s-]/g, '');
    if (type === 'radical') return Number(item.level) === level ? 0 : 2;
    if (type === 'kanji') return Number(item.level) === level ? 1 : 3;
    if (type === 'vocabulary' || type === 'kanavocabulary') return 4;
    throw new Error('Unrecognized WaniKani subject type.');
  }

  function orderSubjects(subjects, metadata, level) {
    if (!validLevel(level)) throw new Error('A level from 1 to 60 is required.');
    const ranks = new Map();
    for (const subject of subjects) {
      if (!Number.isInteger(subject.id) || ranks.has(subject.id)) throw new Error('Invalid or duplicate subject ID.');
      const item = metadata.get(subject.id);
      if (!item || !validLevel(item.level)) throw new Error('Subject level data is unavailable.');
      ranks.set(subject.id, priority(item, level));
    }
    return { subjects: subjects.slice().sort((a, b) => ranks.get(a.id) - ranks.get(b.id)), ranks };
  }

  // Queue ordering retains WaniKani's stats, SRS, question order, and Wrap Up.
  function installQueueOrder(queue, ordered, ranks, onNext) {
    const ids = [...queue.activeQueue, ...queue.backlogQueue].map(item => item.id).concat(queue.remainingIds);
    if (ids.length !== ordered.length || new Set(ids).size !== ids.length || ids.some(id => !ranks.has(id))) {
      throw new Error('The review queue changed while preparing. Reload before answering.');
    }
    if (queue.fetchingMoreItems) throw new Error('WaniKani is loading items. Reload before answering.');
    const original = { nextItem: queue.nextItem, active: queue.activeQueue, backlog: queue.backlogQueue, remaining: queue.remainingIds };
    try {
      queue.activeQueue = ordered.slice(0, queue.maxActiveQueueSize);
      queue.backlogQueue = ordered.slice(queue.maxActiveQueueSize);
      queue.remainingIds = [];
      queue.nextItem = function (...args) {
        // WaniKani shuffles unfinished items inside its active window. Sorting
        // only that window stably keeps mistakes and meaning/reading interleaved
        // within a group while preventing lower-priority groups jumping ahead.
        this.activeQueue.sort((a, b) => ranks.get(a.id) - ranks.get(b.id));
        const result = original.nextItem.apply(this, args);
        onNext?.(this.activeQueue[0] ? ranks.get(this.activeQueue[0].id) : null);
        return result;
      };
      queue.nextItem();
    } catch (error) {
      queue.nextItem = original.nextItem;
      queue.activeQueue = original.active;
      queue.backlogQueue = original.backlog;
      queue.remainingIds = original.remaining;
      throw error;
    }
    return original.nextItem;
  }

  function levelFromDocument(root) {
    // The user menu is account-specific. Never infer a user's level from the
    // highest level among due reviews (which can all be from older levels).
    for (const node of root.querySelectorAll('.user-summary__attribute')) {
      const match = node.textContent.match(/\bLevel\s*(\d{1,2})\b/i);
      if (match && validLevel(match[1])) return Number(match[1]);
    }
    return null;
  }

  function correctAnswers(subject, questionType) {
    if (!subject || !['meaning', 'reading'].includes(questionType)) return [];
    const accepted = new Set(['primary', 'alternative', 'allowed']);
    const entries = questionType === 'meaning' ? subject.meanings : subject.readings;
    const answers = (entries || []).filter(entry => {
      if (!accepted.has(entry.kind) || typeof entry.text !== 'string' || !entry.text.trim()) return false;
      // An alternate reading type may trigger a native retry, not a pass.
      if (questionType === 'reading' && subject.type === 'Kanji') {
        return entry.kind === 'allowed' || entry.type === subject.primary_reading_type;
      }
      return questionType === 'meaning' || subject.type === 'Vocabulary';
    }).sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'));
    return [...new Set(answers.map(entry => entry.text.trim()))];
  }

  function isCurrentLevel(subject, metadata, level) {
    return !!subject && validLevel(level) !== null && validLevel(metadata.get(subject.id)?.level) === level;
  }

  function fillCorrectAnswer(controller, metadata, level) {
    const input = controller.inputTarget;
    if (!isCurrentLevel(controller.currentSubject, metadata, level) || !controller.inputEnabled ||
        controller.submitting || input.disabled || input.readOnly) return false;
    const answer = correctAnswers(controller.currentSubject, controller.currentQuestionType)[0];
    if (!answer) return false;
    input.value = answer;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    controller.inputChars = answer;
    controller.clearException();
    input.focus();
    input.setSelectionRange(answer.length, answer.length);
    return true;
  }

  function installAnswerAssistance(controller, metadata, level, { onWrong, onResult } = {}) {
    const checker = controller.answerChecker;
    if (typeof checker?.evaluate !== 'function' || typeof controller.shakeForm !== 'function' ||
        typeof controller.submitAnswer !== 'function') throw new Error('WaniKani’s answer interface has changed.');
    const original = { evaluate: checker.evaluate, shake: controller.shakeForm, submit: controller.submitAnswer };
    let attempt = null;
    // A display failure must never change how an answer is graded.
    const notify = (callback, ...args) => {
      try { callback?.(...args); } catch (error) { console.warn('[WaniKani Review Priority]', error); }
    };
    const evaluate = function (args) {
      const result = original.evaluate.call(this, args);
      const protectedItem = isCurrentLevel(args.item, metadata, level);
      if (result.action === 'fail' || result.action === 'retry') {
        notify(onWrong, args.item, args.questionType);
      }
      const adjusted = result.action === 'fail' && protectedItem ? {
        ...result, action: 'retry', message: {
          type: 'answerException',
          text: 'Current-level protection: try again. This attempt was not counted wrong.'
        }
      } : result;
      // Repeated taps must not resubmit the same rejected answer automatically.
      if (adjusted.action === 'retry') controller.nextPending = false;
      notify(onResult, adjusted);
      return adjusted;
    };
    const shake = function (...args) {
      if (attempt) attempt.shook = true;
      // Also cover native validation before evaluate (e.g. kana in a meaning
      // field). Empty submissions shake normally without revealing the answer.
      if (this.inputTarget.value.trim()) notify(onWrong, this.currentSubject, this.currentQuestionType);
      return original.shake.apply(this, args);
    };
    const submit = async function (...args) {
      if (this.submitting) return original.submit.apply(this, args);
      const currentAttempt = { shook: false };
      attempt = currentAttempt;
      try { return await original.submit.apply(this, args); }
      finally {
        if (attempt === currentAttempt) {
          attempt = null;
          // Native pre-validation can return early after shaking. Keep retries
          // editable, including when the iOS keyboard submits twice quickly.
          if (currentAttempt.shook) {
            this.inputEnabled = true;
            this.submitting = false;
            this.nextPending = false;
          }
        }
      }
    };
    checker.evaluate = evaluate;
    controller.shakeForm = shake;
    controller.submitAnswer = submit;
    return () => {
      if (checker.evaluate === evaluate) checker.evaluate = original.evaluate;
      if (controller.shakeForm === shake) controller.shakeForm = original.shake;
      if (controller.submitAnswer === submit) controller.submitAnswer = original.submit;
    };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { validLevel, priority, orderSubjects, installQueueOrder, levelFromDocument,
      correctAnswers, isCurrentLevel, fillCorrectAnswer, installAnswerAssistance };
    return;
  }
  if (window.top !== window.self || window.__wkReviewPriorityInstalled) return;
  window.__wkReviewPriorityInstalled = true;

  const isReview = () => /^\/subjects\/review\/?$/.test(location.pathname);
  const attempted = new WeakSet();
  const answered = new WeakSet();
  let activeSession = null;

  function getQueue(element) {
    return window.Stimulus?.getControllerForElementAndIdentifier(element, 'quiz-queue')?.quizQueue;
  }

  function style() {
    if (document.getElementById('wk-priority-style')) return;
    const el = document.createElement('style');
    el.id = 'wk-priority-style';
    el.textContent = `
      .wk-priority-dialog { box-sizing:border-box; width:min(90vw,440px); max-height:85dvh; overflow:auto; border:0; border-radius:16px; padding:24px; background:#fff; color:#222; font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif; box-shadow:0 10px 60px #0005; }
      .wk-priority-dialog::backdrop { background:#0008; }
      .wk-priority-dialog h2 { font-size:20px; margin:0 0 12px; }
      .wk-priority-dialog button { min-height:44px; padding:8px 14px; border:1px solid #aaa; border-radius:8px; background:#f4f4f4; color:#222; font:inherit; margin:8px 8px 0 0; }
      .wk-priority-dialog input { width:90px; min-height:44px; margin:8px; font:inherit; }
      #wk-priority-status { position:fixed; z-index:1000; top:calc(env(safe-area-inset-top,0px) + 6px); left:50%; transform:translateX(-50%); max-width:65vw; min-height:32px; padding:5px 10px; border:1px solid #666; border-radius:16px; background:#fff; color:#222; font:12px/1.3 -apple-system,BlinkMacSystemFont,sans-serif; }
      #wk-priority-assist { padding:8px 12px; text-align:center; font:15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif; }
      #wk-priority-assist button { min-height:44px; padding:8px 16px; border:1px solid #999; border-radius:9px; color:#222; background:#fff; font:inherit; }
      #wk-priority-assist button:disabled { opacity:.5; }
      #wk-priority-assist [hidden] { display:none !important; }
      #wk-priority-answer { margin:8px auto 0; max-width:600px; padding:10px 14px; border:1px solid #b9a34a; border-radius:9px; background:#fff8d9; color:#29230d; overflow-wrap:anywhere; }
    `;
    (document.head || document.documentElement).append(el);
  }

  function dialog(title, message) {
    const el = document.createElement('dialog');
    el.className = 'wk-priority-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const body = document.createElement('p');
    body.textContent = message;
    el.append(heading, body);
    document.body.append(el);
    el.showModal();
    return { el, body };
  }

  function button(parent, text, action) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.addEventListener('click', action);
    parent.append(el);
    return el;
  }

  function status(text, action) {
    document.getElementById('wk-priority-status')?.remove();
    const el = button(document.body, text, action);
    el.id = 'wk-priority-status';
    el.setAttribute('aria-label', `${text}. Show review ordering details`);
    return el;
  }

  function addAnswerControls(controller, metadata, level) {
    document.getElementById('wk-priority-assist')?.remove();
    const container = document.createElement('div');
    container.id = 'wk-priority-assist';
    const cheat = button(container, 'Cheat · Fill answer', event => {
      event.preventDefault();
      event.stopPropagation();
      fillCorrectAnswer(controller, metadata, level);
    });
    const reveal = document.createElement('div');
    reveal.id = 'wk-priority-answer';
    reveal.setAttribute('role', 'status');
    reveal.setAttribute('aria-live', 'polite');
    reveal.hidden = true;
    container.append(reveal);
    controller.element.append(container);
    const refresh = (subject, questionType) => {
      cheat.hidden = !isCurrentLevel(subject, metadata, level) || !correctAnswers(subject, questionType).length;
      cheat.disabled = false;
      reveal.hidden = true;
      reveal.replaceChildren();
    };
    const next = event => refresh(event.detail.subject, event.detail.questionType);
    window.addEventListener('willShowNextQuestion', next);
    refresh(controller.currentSubject, controller.currentQuestionType);
    let restore;
    const cleanup = () => {
      restore?.();
      window.removeEventListener('willShowNextQuestion', next);
      container.remove();
    };
    try {
      restore = installAnswerAssistance(controller, metadata, level, {
        onWrong(subject, questionType) {
          const answers = correctAnswers(subject, questionType);
          const text = document.createElement('span');
          text.textContent = answers.length ? answers.join(' / ') : 'Unavailable; open WaniKani’s item information.';
          if (questionType === 'reading') text.lang = 'ja';
          reveal.replaceChildren(document.createTextNode(`Correct ${questionType}: `), text);
          reveal.hidden = false;
        },
        onResult(result) { cheat.disabled = result.action === 'pass' || result.action === 'fail'; }
      });
    } catch (error) { cleanup(); throw error; }
    return cleanup;
  }

  async function fetchText(path, signal) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin) throw new Error('Unexpected request destination.');
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
    if (!response.ok || new URL(response.url).pathname === '/login') throw new Error('Could not load WaniKani data. Check your connection and sign-in.');
    return response.text();
  }

  async function detectLevel(signal) {
    const local = levelFromDocument(document);
    if (local) return local;
    const html = await fetchText('/dashboard', signal);
    return levelFromDocument(new DOMParser().parseFromString(html, 'text/html'));
  }

  function askLevel(panel, signal) {
    panel.body.textContent = 'Your current level could not be detected. Enter the level shown on your WaniKani dashboard for this session.';
    const label = document.createElement('label');
    label.textContent = 'Current level';
    const input = document.createElement('input');
    input.type = 'number'; input.min = '1'; input.max = '60'; input.inputMode = 'numeric';
    label.append(input);
    panel.el.append(label);
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Reordering canceled.'));
      signal.addEventListener('abort', abort, { once: true });
      const go = button(panel.el, 'Use this level', () => {
        if (!validLevel(input.value)) { input.reportValidity(); return; }
        signal.removeEventListener('abort', abort);
        label.remove(); go.remove();
        panel.body.textContent = 'Preparing your review order…';
        resolve(Number(input.value));
      });
      input.required = true;
      input.focus();
    });
  }

  async function prepare(queue, element, signal) {
    const subjects = [...queue.activeQueue, ...queue.backlogQueue];
    const remaining = [...queue.remainingIds];
    const endpoint = element.dataset.quizQueueItemsUrlValue || '/subjects/review/items';
    for (let offset = 0; offset < remaining.length; offset += 500) {
      const url = new URL(endpoint, location.origin);
      url.searchParams.set('ids', remaining.slice(offset, offset + 500).join('-'));
      const batch = JSON.parse(await fetchText(url.href, signal));
      if (!Array.isArray(batch)) throw new Error('Unexpected WaniKani item response.');
      subjects.push(...batch);
    }
    const metadata = new Map(subjects.map(item => [item.id, item]));
    const missing = subjects.filter(item => !validLevel(item.level)).map(item => item.id);
    if (missing.length) {
      const database = typeof dbManager !== 'undefined' ? dbManager : window.dbManager;
      if (!database?.getItems) throw new Error('WaniKani subject-level data is not ready. Reload and try again.');
      const items = await database.getItems(missing);
      for (const item of items) if (item) metadata.set(item.id, item);
    }
    return { subjects, metadata };
  }

  async function waitForQueue(element, signal) {
    for (let i = 0; i < 100; i++) {
      if (signal.aborted) throw new Error('Reordering canceled.');
      const queue = getQueue(element);
      const inputElement = document.querySelector('[data-controller~="quiz-input"]');
      const input = inputElement && window.Stimulus?.getControllerForElementAndIdentifier(inputElement, 'quiz-input');
      if (queue && input?.answerChecker) return { queue, input };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('WaniKani’s review queue is unavailable. Check that Userscripts has website access, then reload.');
  }

  async function start() {
    if (!isReview()) return;
    const element = document.getElementById('quiz-queue');
    if (!element || attempted.has(element)) return;
    attempted.add(element);
    style();
    const abort = new AbortController();
    const session = { abort, panel: null };
    activeSession = session;
    const panel = dialog('Preparing review priority', 'Loading your current level and the complete review queue…');
    session.panel = panel.el;
    const cancel = () => abort.abort();
    panel.el.addEventListener('cancel', cancel);
    button(panel.el, 'Continue without reordering', cancel);
    // Abort races also bound non-fetch work (e.g. an unavailable IndexedDB).
    const canceled = new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('Reordering canceled or timed out.')), { once: true }));
    let timeout = setTimeout(cancel, 45000);
    try {
      const { queue, input } = await Promise.race([waitForQueue(element, abort.signal), canceled]);
      if (answered.has(element)) throw new Error('Reviews have already started. Reload to apply priority before answering.');
      if (!Array.isArray(queue.activeQueue) || !Array.isArray(queue.backlogQueue) || !Array.isArray(queue.remainingIds) ||
          !Number.isInteger(queue.maxActiveQueueSize) || queue.maxActiveQueueSize < 1 || typeof queue.nextItem !== 'function') {
        throw new Error('WaniKani’s queue format has changed. Reordering was not applied.');
      }
      const [data, detected] = await Promise.race([Promise.all([prepare(queue, element, abort.signal), detectLevel(abort.signal)]), canceled]);
      clearTimeout(timeout);
      const level = detected || await Promise.race([askLevel(panel, abort.signal), canceled]);
      if (abort.signal.aborted || !element.isConnected || !isReview() || activeSession !== session || answered.has(element)) throw new Error('The session changed. Reload to apply review priority.');
      const { subjects, ranks } = orderSubjects(data.subjects, data.metadata, level);
      const counts = GROUPS.map((_, i) => subjects.filter(subject => ranks.get(subject.id) === i).length);
      const details = () => {
        const info = dialog(`Review priority · Level ${level}`, 'Starting queue:');
        const list = document.createElement('ol');
        GROUPS.forEach((name, i) => { const li = document.createElement('li'); li.textContent = `${name}: ${counts[i]}`; list.append(li); });
        info.el.append(list);
        const note = document.createElement('p');
        note.textContent = 'Current-level mistakes are retried without penalty, and the Cheat button fills the answer. All incorrect answers reveal the correct answer. Level is fixed for this session; reload after leveling up. Disable this script and reload to restore normal reviews. Use only one review-ordering or answer-modifying script at a time.';
        info.el.append(note);
        button(info.el, 'Close', () => info.el.remove());
        info.el.addEventListener('close', () => info.el.remove());
      };
      const badge = status(`Priority · Level ${level}`, details);
      session.cleanup = addAnswerControls(input, data.metadata, level);
      installQueueOrder(queue, subjects, ranks, group => {
        badge.textContent = group === null ? 'Priority · Complete' : `L${level} · ${GROUPS[group]}`;
      });
    } catch (error) {
      session.cleanup?.();
      if (activeSession === session && isReview()) {
        console.warn('[WaniKani Review Priority]', error.message);
        status('Priority off · Tap for details', () => {
          const info = dialog('Review priority was not applied', error.message);
          button(info.el, 'Close', () => info.el.remove());
          info.el.addEventListener('close', () => info.el.remove());
        });
      }
    } finally {
      clearTimeout(timeout);
      panel.el.remove();
      if (!abort.signal.aborted) abort.abort();
    }
  }

  window.addEventListener('didAnswerQuestion', () => {
    const element = document.getElementById('quiz-queue');
    if (element) answered.add(element);
  });
  document.addEventListener('turbo:before-cache', () => {
    activeSession?.cleanup?.();
    document.querySelectorAll('.wk-priority-dialog, #wk-priority-status').forEach(el => el.remove());
  });
  document.addEventListener('turbo:before-render', () => {
    activeSession?.cleanup?.();
    activeSession?.abort.abort();
    activeSession?.panel?.remove();
    activeSession = null;
  });
  document.addEventListener('turbo:load', start);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
