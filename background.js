// background.js: Manages card deck storage and FSRS spaced repetition selection.

const w = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];

// Helper constraint
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

// Pure function. Applies FSRS-6 algorithm to a card after review and returns the mutated card.
function updateCard(card, quality, isCram = false) {
  if (isCram) return card; // Cram mode does not affect wait times or states

  const now = Date.now();
  let { difficulty: D, stability: S, state, reps, lapses, last_review } = card;

  // Grade is 1-4
  const G = quality;

  if (state === 'New' || reps === 0) {
    S = w[G - 1]; // S_0(G)
    const D_0 = w[4] - Math.exp(w[5] * (G - 1)) + 1;
    D = clamp(D_0, 1, 10);
    
    state = (G === 1 || G === 2) ? 'Learning' : 'Review';
    reps = 1;
    lapses = (G === 1) ? 1 : 0;
  } else {
    // Time since last review in days
    // Fallback if last_review is somehow null
    const elapsed_days = last_review ? (now - last_review) / 86400000 : 0;
    
    // Retrievability
    const factor = Math.pow(0.9, -1 / w[20]) - 1;
    const R = clamp(Math.pow(1 + factor * elapsed_days / S, -w[20]), 0, 1);

    // Difficulty update
    const delta_D = -w[6] * (G - 3);
    const D_next = D + delta_D * ((10 - D) / 9);
    // Mean reversion against D_0(4)
    const D_0_4 = w[4] - Math.exp(w[5] * 3) + 1;
    D = clamp(w[7] * D_0_4 + (1 - w[7]) * D_next, 1, 10);

    // Stability update
    if (G === 1) { // Lapse
      S = w[11] * Math.pow(D, -w[12]) * (Math.pow(S + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
      S = Math.max(S, 0.1); // minimum stability
      state = 'Relearning';
      lapses += 1;
    } else {
      // Retained
      // FSRS-6: "same-day" formula when elapsed_days < 1 day (or learning/relearning)
      if (state === 'Learning' || state === 'Relearning' || elapsed_days < 0.1) {
        let S_inc = Math.exp(w[17] * (G - 3 + w[18])) * Math.pow(S, -w[19]);
        if (G >= 3) S_inc = Math.max(S_inc, 1);
        S = S * S_inc;
        state = 'Review';
      } else {
        // Normal review increment
        let modifier = 1;
        if (G === 2) modifier = w[15];
        else if (G === 4) modifier = w[16];
        
        const S_inc = Math.exp(w[8]) * (11 - D) * Math.pow(S, -w[9]) * (Math.exp(w[10] * (1 - R)) - 1) * modifier;
        S = S * (1 + S_inc);
        state = 'Review';
      }
    }
    reps += 1;
  }

  card.difficulty = D;
  card.stability = S;
  card.state = state;
  card.reps = reps;
  card.lapses = lapses;
  card.last_review = now;
  
  // Calculate interval using FSRS target retention formula
  // We use 95% retention instead of default 90% to shorten intervals naturally
  const requestedRetention = 0.95;
  const factor = Math.pow(0.9, -1 / w[20]) - 1;
  let intervalDays = (S / factor) * (Math.pow(requestedRetention, -1 / w[20]) - 1);

  if (state === 'Learning' || state === 'Relearning') {
     intervalDays = (G === 1) ? (1 / 1440) : (5 / 1440); // 1 or 5 minutes
  }
  
  card.dueDate = now + intervalDays * 86400000;
  return card;
}

async function ensureDataFreshness() {
  try {
    const data = await browser.storage.local.get(['cards', 'lastReset']);
    const now = Date.now();
    const RESET_INTERVAL = 604800000; // 7 days

    if (!data.cards || !data.lastReset || (now - data.lastReset > RESET_INTERVAL)) {
      const response = await fetch(browser.runtime.getURL('cards.json'));
      const defaultData = await response.json();
      // Initialize with FSRS defaults
      const cards = defaultData.cards.map(c => ({
        id: c.id,
        front: c.front,
        back: c.back,
        state: 'New',
        difficulty: 0,
        stability: 0,
        reps: 0,
        lapses: 0,
        last_review: null,
        dueDate: null
      }));
      await browser.storage.local.set({ cards, lastReset: now });
      console.log('Cards loaded or reset due to expiry.');
    }
  } catch (error) {
    console.error('Error ensuring data freshness:', error);
  }
}

async function selectCard(isCram = false) {
  try {
    const data = await browser.storage.local.get(['cards', 'currentCard']);
    if (!data.cards || data.cards.length === 0) return null;

    const cards = data.cards;
    const currentCardId = data.currentCard ? data.currentCard.id : null;

    if (isCram) {
      let pool = cards;
      if (pool.length > 1) {
        let filtered = pool.filter(c => c.id !== currentCardId);
        if (filtered.length > 0) pool = filtered;
      }
      return pool[Math.floor(Math.random() * pool.length)];
    }

    let minDue = Infinity;
    let pool = [];
    
    // Single pass: find absolute minimum due date and collect pool
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const due = c.dueDate || 0;
      if (due < minDue) {
        minDue = due;
        pool = [c];
      } else if (due === minDue) {
        pool.push(c);
      }
    }

    // Apply anti-repetition if there are multiple candidates
    if (pool.length > 1) {
      const filteredPool = pool.filter(c => c.id !== currentCardId);
      if (filteredPool.length > 0) pool = filteredPool;
    }

    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
  } catch (error) {
    console.error('Error selecting card:', error);
    return null;
  }
}

async function refreshCurrentCard(isCram = false) {
  try {
    await ensureDataFreshness();
    const card = await selectCard(isCram);
    if (card) {
      await browser.storage.local.set({ currentCard: card });
    }
    return card;
  } catch (error) {
    console.error('Error refreshing current card:', error);
    return null;
  }
}

browser.runtime.onInstalled.addListener(() => {
  ensureDataFreshness().then(() => refreshCurrentCard(false));
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getNewCard') {
    refreshCurrentCard(message.isCram || false).then(card => {
      sendResponse({ card });
    }).catch(error => {
      console.error('Error handling getNewCard:', error);
      sendResponse({ card: null });
    });
    return true;
  }

  if (message.action === 'reviewCard') {
    (async () => {
      try {
        const data = await browser.storage.local.get('cards');
        if (!data.cards) {
          sendResponse({ success: false, error: 'No cards in storage' });
          return;
        }
        const cards = data.cards;
        const index = cards.findIndex(c => c.id === message.cardId);
        if (index === -1) {
          sendResponse({ success: false, error: 'Card not found' });
          return;
        }
        const updatedCard = updateCard(cards[index], message.quality, message.isCram);
        cards[index] = updatedCard;
        await browser.storage.local.set({ cards });
        sendResponse({ success: true, card: updatedCard });
      } catch (error) {
        console.error('Error handling reviewCard:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});
