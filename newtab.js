// newtab.js: Main UI logic for the new tab page.

let currentCardData = null;
let isProcessing = false;
let hasBeenFlipped = false;
let mouseInZone = false;
let countdownInterval = null;
let forceCramMode = false;
let isInitialLoad = true;

// DOM Cache
const cardEl = document.getElementById('card');
const cardFrontEl = document.getElementById('cardFront');
const cardBackEl = document.getElementById('cardBack');
const btn1 = document.getElementById('btn1');
const btn2 = document.getElementById('btn2');
const btn3 = document.getElementById('btn3');
const btn4 = document.getElementById('btn4');
const arcButtons = document.getElementById('arcButtons');
const cardZone = document.getElementById('cardZone');
const statsTextEl = document.getElementById('statsText');
const countdownTimerEl = document.getElementById('countdownTimer');
const forceReviewBtn = document.getElementById('forceReviewBtn');

document.addEventListener('DOMContentLoaded', async () => {
  if (cardBackEl) cardBackEl.style.display = 'flex';

  await loadNewCard();

  cardEl.addEventListener('click', flipCard);

  // Event delegation: single listener on parent instead of 4 individual ones
  arcButtons.addEventListener('click', (e) => {
    const target = e.target.closest('.arc-btn');
    if (!target) return;
    const quality = parseInt(target.id.replace('btn', ''), 10);
    handleReview(quality, `flash-${quality}`);
  });
  document.addEventListener('keydown', handleKeyDown);

  // Grace zone: track mouse presence, show/hide arc buttons accordingly
  cardZone.addEventListener('mouseenter', () => {
    mouseInZone = true;
    if (hasBeenFlipped) arcButtons.classList.add('arc-visible');
  });
  cardZone.addEventListener('mouseleave', () => {
    mouseInZone = false;
    arcButtons.classList.remove('arc-visible');
  });

  // Hidden clickable button in top left to enter cram mode
  forceReviewBtn.addEventListener('click', () => {
    forceCramMode = true;
    loadCurrentCard();
  });

  // Top Sites: batch DOM insertions via DocumentFragment for single reflow
  if (typeof browser !== 'undefined' && browser.topSites) {
    browser.topSites.get({ includeFavicon: true }).then(sites => {
      const container = document.getElementById('shortcuts-container');
      if (!container) return;

      const fragment = document.createDocumentFragment();

      sites.slice(0, 8).forEach(site => {
        const a = document.createElement('a');
        a.href = site.url;
        a.className = 'shortcut-tile';

        const img = document.createElement('img');
        img.className = 'shortcut-icon';
        img.src = site.favicon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="%23ffffff11"/></svg>';

        const span = document.createElement('span');
        span.className = 'shortcut-title';
        span.textContent = site.title || site.url;

        a.appendChild(img);
        a.appendChild(span);
        fragment.appendChild(a);
      });

      container.appendChild(fragment); // Single DOM insertion
    }).catch(err => console.error('Error fetching topSites:', err));
  }
});

// ─── Card Flip ────────────────────────────────────────────

function flipCard() {
  cardEl.classList.toggle('flipped');
  if (cardEl.classList.contains('flipped')) hasBeenFlipped = true;
  if (hasBeenFlipped && mouseInZone) arcButtons.classList.add('arc-visible');
}

// ─── Card Loading ─────────────────────────────────────────

async function loadCurrentCard() {
  try {
    const data = await browser.storage.local.get(['currentCard', 'cards']);
    if (data.currentCard) {
      currentCardData = data.currentCard;

      // Prevent answer leak: kill the transition, snap to front instantly,
      // update text while on the question side, then restore the transition.
      cardEl.style.transition = 'none';
      cardEl.classList.remove('flipped');
      arcButtons.classList.remove('arc-visible');
      hasBeenFlipped = false;

      cardFrontEl.textContent = currentCardData.front || 'No front text available.';
      cardBackEl.textContent = currentCardData.back || 'No back text available.';

      // Force reflow so the browser commits the non-animated state
      void cardEl.offsetHeight;
      cardEl.style.transition = '';

      updateStatsDisplay(data.cards);

      // Clear any existing countdown
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }

      if (forceCramMode) {
        document.body.classList.add('cram-mode');
      } else {
        document.body.classList.remove('cram-mode');
      }

      // Check if deck is complete (card naturally returned by background logic isn't due yet)
      const isLearning = currentCardData.state === 'Learning' || currentCardData.state === 'Relearning';
      const earlyTolerance = isLearning ? 20 * 60 * 1000 : 0;

      if (!forceCramMode && currentCardData.dueDate != null && currentCardData.dueDate > Date.now() + earlyTolerance) {
        if (!document.body.classList.contains('deck-complete') && !isInitialLoad) {
          document.body.classList.add('just-completed');
          setTimeout(() => document.body.classList.remove('just-completed'), 700);
        }
        document.body.classList.add('deck-complete');

        const updateTimer = () => {
          const diff = currentCardData.dueDate - Date.now();
          if (diff <= 0) {
            clearInterval(countdownInterval);
            loadCurrentCard();
            return;
          }
          const hours = Math.floor(diff / 3600000);
          const mins = Math.floor((diff % 3600000) / 60000);

          if (hours > 0) {
            countdownTimerEl.textContent = `Next card in ${hours} hr ${mins} min`;
          } else if (mins > 0) {
            countdownTimerEl.textContent = `Next card in ${mins} min`;
          } else {
            countdownTimerEl.textContent = `Next card in < 1 min`;
          }
        };

        updateTimer();
        countdownInterval = setInterval(updateTimer, 60000);
      } else {
        document.body.classList.remove('deck-complete');
      }

    } else {
      cardFrontEl.textContent = 'No cards available. Check cards.json.';
      cardBackEl.textContent = '';
      document.body.classList.remove('deck-complete');
    }

    // Reveal UI now that state is fully processed
    document.getElementById('mainContainer').style.visibility = 'visible';
    isInitialLoad = false;

  } catch (error) {
    console.error('Failed to load current card:', error);
  }

  isProcessing = false;
  setButtonsState(false);
}

function updateStatsDisplay(cards) {
  try {
    if (cards) {
      const now = Date.now();
      let dueCount = 0;
      let learnedCount = 0;
      // Single pass instead of two map/filters
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const isLearning = c.state === 'Learning' || c.state === 'Relearning';
        const earlyTolerance = isLearning ? 20 * 60 * 1000 : 0;

        if (c.dueDate == null || c.dueDate <= now + earlyTolerance) dueCount++;
        if (c.state === 'Review') learnedCount++;
      }
      statsTextEl.textContent = `Due: ${dueCount} | Learned: ${learnedCount}`;
    }
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// ─── Mark Quality ─────────────────────────────────────────
// Uses reviewCard message to delegate FSRS-6 update to background.js.
// Quality mapping: 1 (Again) → 4 (Easy), matching FSRS-6 grade scale.

async function handleReview(quality, flashClass) {
  if (!currentCardData || isProcessing) return;
  isProcessing = true;
  setButtonsState(true);

  cardEl.classList.add(flashClass);
  setTimeout(() => cardEl.classList.remove(flashClass), 260);

  try {
    await browser.runtime.sendMessage({
      action: 'reviewCard',
      cardId: currentCardData.id,
      quality,
      isCram: forceCramMode
    });
  } catch (error) {
    console.error('Error reviewing card:', error);
  }

  setTimeout(loadNewCard, 260);
}

// ─── Load New Card ────────────────────────────────────────

async function loadNewCard() {
  try {
    const response = await browser.runtime.sendMessage({ action: 'getNewCard', isCram: forceCramMode });
    if (response && response.card) {
      await loadCurrentCard();
    } else {
      showSystemError('No cards available. Deck complete or check cards.json.');
    }
  } catch (error) {
    showSystemError('System encountered an error communicating with background script.');
  }
}

function showSystemError(msg) {
  cardFrontEl.textContent = msg;
  cardBackEl.textContent = '';
  document.body.classList.remove('deck-complete');
  document.getElementById('mainContainer').style.visibility = 'visible';
  isProcessing = false;
  setButtonsState(false);
}

// ─── Utilities ────────────────────────────────────────────

function setButtonsState(disabled) {
  btn1.disabled = disabled;
  btn2.disabled = disabled;
  btn3.disabled = disabled;
  btn4.disabled = disabled;
}

// Keyboard: 1-4 for FSRS-6 grade scale, arrows for Again/Easy
function handleKeyDown(e) {
  if (isProcessing) return;

  if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
    e.preventDefault();
    flipCard();
  } else if (e.key === '1' || e.key === 'ArrowLeft') {
    e.preventDefault();
    handleReview(1, 'flash-1');
  } else if (!forceCramMode && e.key === '2') {
    e.preventDefault();
    handleReview(2, 'flash-2');
  } else if (!forceCramMode && e.key === '3') {
    e.preventDefault();
    handleReview(3, 'flash-3');
  } else if (e.key === '4' || e.key === 'ArrowRight') {
    e.preventDefault();
    handleReview(4, 'flash-4');
  }
}
