/**
 * CONDEMNED — Hangman Multiplayer Server
 * Node.js + Express + ws (WebSocket)
 *
 * Each "room" holds exactly 2 players.
 * Player 1 sets the word (kept server-side in plaintext; never sent to the
 * guesser until the round ends).
 * Player 2 guesses — either letter by letter, or by calling the word
 * outright with ONE whole-word guess. A wrong whole-word guess is an
 * instant loss, no further guessing allowed.
 * Roles swap each round.
 */

const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const path    = require('path');
const crypto  = require('crypto');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── serve static files from /public ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── in-memory room store ──────────────────────────────────────────────────
// rooms[roomCode] = { players: [ws, ws], state: {...}, word: 'PLAINTEXT' }
const rooms = {};

function makeCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F7B2"
}

function broadcast(room, msg) {
  room.players.forEach(ws => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  });
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ── initial game state ────────────────────────────────────────────────────
function freshState(settings) {
  return {
    phase:       'waiting',   // waiting | word_entry | game | result | series_end
    round:       0,
    setterIdx:   0,           // index in players[] who sets the word
    wordLength:  0,
    wordSpaces:  [],          // indices of spaces
    category:    '',
    hint:        '',
    guessed:     [],          // letters guessed so far
    revealedPositions: [],    // [{pos, char}] accumulated correct letters
    wrongCount:  0,
    maxWrong:    settings.maxWrong  || 6,
    timerOn:     settings.timerOn   || false,
    timerSecs:   settings.timerSecs || 30,
    seriesMode:  settings.seriesMode|| false,
    seriesMax:   settings.seriesMax || 3,
    scores:      [0, 0],
    roundWon:    null,
    revealWord:  '',          // plaintext only sent after round ends
    names:       ['', ''],
    hintUsed:    false,
    wordSet:     false,
    wholeWordGuessUsed: false, // the single whole-word guess has been spent
  };
}

// ── helpers ─────────────────────────────────────────────────────────────
function checkWin(st, word) {
  const allLetters = word.replace(/ /g, '').split('');
  return allLetters.every(c => st.guessed.includes(c));
}

function endRound(room, won) {
  const st = room.state;
  st.phase      = 'result';
  st.roundWon   = won;
  st.revealWord = room.word;

  if (won) {
    st.scores[1 - st.setterIdx]++;
  } else {
    st.scores[st.setterIdx]++;
  }

  let seriesOver = false;
  if (st.seriesMode) {
    const need = Math.ceil(st.seriesMax / 2);
    if (st.scores[0] >= need || st.scores[1] >= need) seriesOver = true;
  }

  broadcast(room, {
    type: 'round_over',
    won,
    revealWord: st.revealWord,
    state: st,
    seriesOver,
  });
}

// ── WebSocket connection ──────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.playerIdx = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── CREATE ROOM ──────────────────────────────────────────────────
      case 'create_room': {
        const code = makeCode();
        const settings = msg.settings || {};
        rooms[code] = {
          players: [ws, null],
          state:   freshState(settings),
          word:    '',
        };
        rooms[code].state.names[0] = msg.name || 'Player 1';
        ws.roomCode  = code;
        ws.playerIdx = 0;
        sendTo(ws, { type: 'room_created', code, playerIdx: 0 });
        break;
      }

      // ── JOIN ROOM ────────────────────────────────────────────────────
      case 'join_room': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms[code];
        if (!room) { sendTo(ws, { type: 'error', msg: 'Room not found.' }); return; }
        if (room.players[1]) { sendTo(ws, { type: 'error', msg: 'Room is full.' }); return; }

        room.players[1]  = ws;
        room.state.names[1] = msg.name || 'Player 2';
        ws.roomCode  = code;
        ws.playerIdx = 1;

        // tell joiner who they are
        sendTo(ws, { type: 'joined_room', code, playerIdx: 1, state: room.state });

        // start game
        room.state.phase = 'word_entry';
        room.state.round = 1;
        room.state.setterIdx = 0;
        broadcast(room, { type: 'game_start', state: room.state });
        break;
      }

      // ── SET WORD (plaintext, kept server-side only) ──────────────────
      case 'set_word': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        if (ws.playerIdx !== room.state.setterIdx) return; // only setter can set

        const word = (msg.word || '').toUpperCase().trim();
        if (!word || !/^[A-Z\s]+$/.test(word)) {
          sendTo(ws, { type: 'error', msg: 'Letters and spaces only.' });
          return;
        }

        room.word = word; // never sent to the guesser until reveal

        const wordSpaces = word.split('').map((c, i) => c === ' ' ? i : -1).filter(i => i >= 0);

        room.state.wordLength    = word.length;
        room.state.wordSpaces    = wordSpaces;
        room.state.category      = msg.category || 'Custom';
        room.state.hint          = msg.hint || '';
        room.state.guessed       = [];
        room.state.revealedPositions = [];
        room.state.wrongCount    = 0;
        room.state.hintUsed      = false;
        room.state.wordSet       = true;
        room.state.wholeWordGuessUsed = false;
        room.state.phase         = 'game';

        broadcast(room, { type: 'word_set', state: room.state });
        break;
      }

      // ── GUESS A LETTER ────────────────────────────────────────────────
      case 'guess': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        const st = room.state;
        if (st.phase !== 'game') return;

        const guesserIdx = 1 - st.setterIdx;
        if (ws.playerIdx !== guesserIdx) return; // only guesser guesses

        const letter = (msg.letter || '').toUpperCase();
        if (!/^[A-Z]$/.test(letter)) return;
        if (st.guessed.includes(letter)) return;

        st.guessed.push(letter);

        const word = room.word;
        const isCorrect = word.includes(letter);
        const correctPositions = word.split('').map((c, i) => c === letter ? i : -1).filter(i => i >= 0);

        correctPositions.forEach(pos => {
          if (!st.revealedPositions.find(r => r.pos === pos)) {
            st.revealedPositions.push({ pos, char: letter });
          }
        });

        if (!isCorrect) st.wrongCount++;

        const won = checkWin(st, word);
        const lost = st.wrongCount >= st.maxWrong;

        if (won || lost) {
          endRound(room, won);
        } else {
          broadcast(room, {
            type: 'guess_validated',
            letter, isCorrect, correctPositions,
            state: st,
          });
        }
        break;
      }

      // ── GUESS THE WHOLE WORD (one shot — wrong guess = instant loss) ──
      case 'guess_word': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        const st = room.state;
        if (st.phase !== 'game') return;
        if (st.wholeWordGuessUsed) return; // already spent

        const guesserIdx = 1 - st.setterIdx;
        if (ws.playerIdx !== guesserIdx) return; // only guesser guesses

        const attempt = (msg.word || '').toUpperCase().trim();
        if (!attempt) return;

        st.wholeWordGuessUsed = true;

        const won = attempt === room.word;
        endRound(room, won);
        break;
      }

      // ── USE HINT ─────────────────────────────────────────────────────
      case 'use_hint': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        const st = room.state;
        if (st.hintUsed || !st.hint) return;
        st.hintUsed   = true;
        st.wrongCount = Math.min(st.wrongCount + 1, st.maxWrong);

        if (st.wrongCount >= st.maxWrong) {
          endRound(room, false);
        } else {
          broadcast(room, { type: 'hint_used', hint: st.hint, state: st });
        }
        break;
      }

      // ── SURRENDER ────────────────────────────────────────────────────
      case 'surrender': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        const st = room.state;
        if (ws.playerIdx !== 1 - st.setterIdx) return;
        st.wrongCount = st.maxWrong;
        endRound(room, false);
        break;
      }

      // ── NEXT ROUND ───────────────────────────────────────────────────
      case 'next_round': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        const st = room.state;
        st.round++;
        st.setterIdx    = st.round % 2 === 1 ? 0 : 1;
        st.phase        = 'word_entry';
        st.guessed      = [];
        st.revealedPositions = [];
        st.wrongCount   = 0;
        st.wordSet      = false;
        st.revealWord   = '';
        st.roundWon     = null;
        st.wholeWordGuessUsed = false;
        room.word       = '';
        broadcast(room, { type: 'next_round', state: st });
        break;
      }

      // ── TIMER TICK (setter pushes ticks to keep in sync) ─────────────
      case 'timer_expired': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        if (ws.playerIdx !== room.state.setterIdx) return;
        const st = room.state;
        st.wrongCount = Math.min(st.wrongCount + 1, st.maxWrong);

        if (st.wrongCount >= st.maxWrong) {
          endRound(room, false);
        } else {
          broadcast(room, { type: 'timer_expired', state: st });
        }
        break;
      }
    }
  });

  // ── disconnect ──────────────────────────────────────────────────────────
  ws.on('close', () => {
    const room = rooms[ws.roomCode];
    if (!room) return;
    room.players[ws.playerIdx] = null;
    const other = room.players[1 - ws.playerIdx];
    sendTo(other, { type: 'opponent_left' });
    // clean up if both gone
    if (!room.players[0] && !room.players[1]) delete rooms[ws.roomCode];
  });
});

// ── start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`⚰️  Condemned server running on http://localhost:${PORT}`));
