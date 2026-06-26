# condemned-hangman

A dark, two-player hangman game played over WebSockets. One player sets a
secret word, the other tries to take it down — letter by letter, or in one
reckless guess.

## How it works

- **Player 1** picks a word, a category, and an optional hint, then sends it.
  The word is kept server-side and never shown to Player 2 until the round ends.
- **Player 2** guesses letters one at a time, building up the gallows with
  every wrong answer.
- At any point, Player 2 can also call the **whole word** outright:
  - Guess it right → instant win.
  - Guess it wrong → instant loss, immediately. No more letters after that.
  - This whole-word guess can only be used **once per round**.
- Roles swap each round. Play a single round or a best-of-N series.

## Tech stack

- **Server:** Node.js, Express, [`ws`](https://github.com/websockets/ws) for WebSockets
- **Client:** Single static `index.html` — no build step, no frontend framework

## Quick start

```bash
npm install
npm start
```

Then open `http://localhost:3000` in two separate browser tabs/windows:

1. **Tab 1:** Create Room → share the generated room code
2. **Tab 2:** Enter the code → Join

## Project structure

```
condemned-hangman/
├── server.js          # WebSocket + Express server (game logic, word storage)
├── package.json
└── public/
    └── index.html     # Full client UI, styling, and game logic
```

## Deploying

Want to play with someone over the internet instead of on the same network?
See [HOSTING.md](./HOSTING.md) for step-by-step guides covering Railway,
Render, a plain VPS with Nginx, and LAN play.

## License

For personal/educational use. Do whatever you'd like with it.
