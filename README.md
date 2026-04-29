# TabFlash

TabFlash is a Firefox extension that replaces the default new tab page with a flashcard interface. It utilizes a simplified, inference-only version of the FSRS-6 algorithm (Free Spaced Repetition Scheduler) to manage card scheduling, storing data persistently in browser local storage.

> [!NOTE]
> This extension may request the `topSites` permission (often described as browser history). This is used solely to display your top 8 most visited sites on the "Deck Complete" screen, providing a familiar experience similar to the default Firefox new tab page. No information from this extension will ever leave your device.

## Core Functionality

- **FSRS-6 Algorithm Implementation:** Cards are scheduled based on the FSRS-6 spaced repetition formulas. Performance data (Stability, Difficulty, and State logic) is updated with each review to dictate learning step intervals and long-term retention.
- **Card Selection:** The system prioritizes cards that are overdue based on their calculated due dates. If no cards are due, the system permits early lookahead (up to 20 minutes) for cards still in the `Learning` phase, prioritizing fluid studying over unnecessary wait screens. If the deck is truly complete, a live countdown to the next available card is shown.
- **Persistent Storage:** All scheduling data and card metadata are stored locally using the `browser.storage.local` API.
- **Input Methods:**
  - **Keyboard:** `Space` or `Enter` to flip the card. Use number keys `1` to `4` (or `Left`/`Right` arrows for Again/Easy) to directly map to the 4 grades in the FSRS equations.
  - **Mouse:** Click to flip the card; use the four color-scaled buttons (Red, Orange, Yellow, Green) appearing below the card to assign performance grades.

## User Interface

- **Deck Complete State:** When no cards are due, the interface displays a countdown timer indicating the time remaining until the next scheduled review. It also shows the user's top 8 sites, similarly to the default Firefox new tab.
- **Cram Mode:** An optional feature allows users to review cards out-of-schedule. Hover over the top-left area during the Deck Complete state and click the "Cram Mode" button. Reviews conducted in Cram Mode do not penalize or alter FSRS scheduling parameters.
- **Metrics Display:** A display in the top-right corner monitors active deck performance. It shows the number of cards `Due` and the number of cards that have successfully graduated to the `Review` status.
- **Typography:** The interface utilizes serif fonts for card content (Georgia) and a system sans-serif stack for UI elements and metrics.

## Installation

1. Navigate to `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on...**.
3. Select the `manifest.json` file from the project directory.

## Configuration (`cards.json`)

Cards are defined in a JSON file following the FSRS structural schema:

```json
{
  "id": "string",
  "front": "string",
  "back": "string",
  "state": "New",
  "difficulty": 0,
  "stability": 0,
  "reps": 0,
  "lapses": 0,
  "last_review": null,
  "dueDate": null
}
```

### Automated Generation
You can prompt large language models to generate content in the required FSRS format:

> "Generate [Number] flashcards on [Topic] in JSON format. Return an object with a `cards` array. Required fields for each card: `id` (unique string), `front` (question), `back` (answer), `state` ('New'), `difficulty` (0), `stability` (0), `reps` (0), `lapses` (0), `last_review` (null), and `dueDate` (null)."

## Data Management

The extension includes a mechanism to reset progress if the application remains unused for a period of 7 days. To manually erase all FSRS state and restore the default schema from `cards.json`:

1. Access the extension's background console via `about:debugging`.
2. Execute `browser.storage.local.clear()`.
3. Open a new tab to reinitialize the storage logic.
