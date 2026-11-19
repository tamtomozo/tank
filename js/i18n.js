(function (global) {
  'use strict';

  // Language of the page: Japanese by default, English with ?lang=en (index.html?lang=en).
  // Loaded first: every later script picks its texts with L(ja, en) when it builds them.
  //   Text in index.html: an element with data-en="…" gets that text, data-en-html="…" that markup
  //   (for text mixed with <kbd> etc.), data-en-aria-label / data-en-title those attributes.
  //   Operation texts (briefings, Mio's lines): js/data/operations.en.js, laid over the Japanese data.

  let lang = 'ja';
  try {
    if (new URLSearchParams(global.location.search).get('lang') === 'en') lang = 'en';
  } catch (e) {
    lang = 'ja';
  }
  const EN = lang === 'en';

  // The text for the page language: L('日本語', 'English')
  function L(ja, en) {
    return EN ? en : ja;
  }

  // Swap the static texts of index.html (runs before the other scripts look the elements up)
  function applyPage() {
    document.documentElement.lang = lang;
    if (!EN) return;
    document.querySelectorAll('[data-en]').forEach((el) => {
      el.textContent = el.dataset.en;
    });
    document.querySelectorAll('[data-en-html]').forEach((el) => {
      el.innerHTML = el.dataset.enHtml;
    });
    for (const attr of ['aria-label', 'title']) {
      document.querySelectorAll(`[data-en-${attr}]`).forEach((el) => {
        el.setAttribute(attr, el.getAttribute(`data-en-${attr}`));
      });
    }
    const title = document.querySelector('title[data-en]');
    if (title) document.title = title.dataset.en;
  }

  global.I18n = { lang, isEn: EN, L };
  global.L = L;
  applyPage();
})(window);
