const colors = ["red", "blue", "orange", "cyan"];
const colorLabels = { red: "Red", orange: "Orange", blue: "Blue", cyan: "Cyan" };
const teams = { red: "warm", orange: "warm", blue: "cool", cyan: "cool" };
const variantLabels = {
  standard: "Standard 2v2",
  "partner-anchor": "Partner-Anchor 2v2",
  "self-anchor": "Self-Anchor 2v2",
};

const els = {
  board: document.querySelector("#board"),
  connection: document.querySelector("#connection"),
  copyLink: document.querySelector("#copyLink"),
  joinForm: document.querySelector("#joinForm"),
  leaveSeat: document.querySelector("#leaveSeat"),
  message: document.querySelector("#message"),
  players: document.querySelector("#players"),
  resetGame: document.querySelector("#resetGame"),
  rulesButton: document.querySelector("#rulesButton"),
  rulesContent: document.querySelector("#rulesContent"),
  rulesDialog: document.querySelector("#rulesDialog"),
  roomLabel: document.querySelector("#roomLabel"),
  teamChoices: [...document.querySelectorAll(".teamChoice")],
  username: document.querySelector("#username"),
  variantSelect: document.querySelector("#variantSelect"),
  warmScore: document.querySelector("#warmScore"),
  coolScore: document.querySelector("#coolScore"),
};

const roomId = location.pathname.split("/").filter(Boolean).at(-1);
let selectedTeam = "warm";
let socket;
let state;
let online = [];
let previousBoard = null;
let playerId = localStorage.getItem("crossCapturePlayerId");

if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem("crossCapturePlayerId", playerId);
}

els.roomLabel.textContent = `Room ${roomId}`;
els.username.value = localStorage.getItem("crossCaptureName") || "";

for (const choice of els.teamChoices) {
  choice.addEventListener("click", () => {
    selectedTeam = choice.dataset.team;
    for (const item of els.teamChoices) {
      item.classList.toggle("selected", item === choice);
    }
  });
}

els.copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  els.copyLink.textContent = "Copied";
  setTimeout(() => {
    els.copyLink.textContent = "Copy link";
  }, 1000);
});

els.resetGame.addEventListener("click", () => {
  send({ type: "reset", variant: els.variantSelect.value });
});

els.variantSelect.addEventListener("change", () => {
  if (state?.phase === "lobby") {
    send({ type: "reset", variant: els.variantSelect.value });
  }
});

els.rulesButton.addEventListener("click", () => {
  renderRules();
  els.rulesDialog.showModal();
});

els.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = els.username.value.trim();
  if (!name) {
    els.username.focus();
    return;
  }
  localStorage.setItem("crossCaptureName", name);
  send({ type: "join", playerId, name, team: selectedTeam });
});

els.leaveSeat.addEventListener("click", () => {
  send({ type: "leave", playerId });
  playerId = crypto.randomUUID();
  localStorage.setItem("crossCapturePlayerId", playerId);
});

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws/${roomId}`);

  socket.addEventListener("open", () => {
    setConnection("");
    const name = els.username.value.trim();
    if (name) {
      send({ type: "join", playerId, name, team: selectedTeam });
    }
  });

  socket.addEventListener("close", () => {
    setConnection("Reconnecting...");
    setTimeout(connect, 800);
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      state = message.state;
      online = message.online;
      render();
    }
    if (message.type === "error") {
      els.message.textContent = message.message;
    }
  });
}

function setConnection(message) {
  els.connection.textContent = message;
  els.connection.hidden = !message;
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function render() {
  if (!state) {
    return;
  }

  const me = state.players.find((player) => player.id === playerId);
  const variant = normalizeVariant(state.variant);
  const legal = new Set(me?.color === state.turn && state.phase === "playing" ? legalMoves(state.board, me.color, variant) : []);
  const counts = score(state.board);

  document.body.classList.toggle("is-lobby", state.phase === "lobby");
  document.body.classList.toggle("needs-join", state.phase === "lobby" && !me);
  els.message.textContent = displayMessage(me);
  els.warmScore.textContent = String(counts.red + counts.orange);
  els.coolScore.textContent = String(counts.blue + counts.cyan);
  els.joinForm.hidden = Boolean(me) || state.phase !== "lobby";
  els.leaveSeat.hidden = !me;
  els.resetGame.disabled = !state.players.some((player) => player.id === playerId);
  els.resetGame.hidden = els.resetGame.disabled;
  els.variantSelect.value = variant;

  const oldBoard = previousBoard;
  els.board.innerHTML = "";
  state.board.forEach((cell, index) => {
    const oldCell = oldBoard?.[index] ?? null;
    const changed = Boolean(oldBoard) && oldCell !== cell;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cell";
    button.disabled = !legal.has(index);
    button.classList.toggle("legal", legal.has(index));
    button.classList.toggle("lastMove", state.lastMove === index);
    button.setAttribute("aria-label", cell ? `${colorLabels[cell]} disc` : `Empty square ${index + 1}`);

    if (cell) {
      const disc = document.createElement("span");
      disc.className = "disc";
      if (changed && oldCell) {
        disc.classList.add("flip");
        disc.dataset.previousColor = oldCell;
      }
      if (changed && !oldCell) {
        disc.classList.add("place");
      }
      disc.dataset.color = cell;
      button.append(disc);
    }

    if (legal.has(index)) {
      button.addEventListener("click", () => send({ type: "move", playerId, index }));
    }

    els.board.append(button);
  });

  renderPlayers();
  previousBoard = [...state.board];
}

function renderPlayers() {
  els.players.innerHTML = "";
  const ordered = orderedTurns();
  for (const [index, color] of ordered.entries()) {
    const player = state.players.find((candidate) => candidate.color === color);
    const row = document.createElement("div");
    row.className = "player";
    row.dataset.color = color;
    row.classList.toggle("active", state.phase === "playing" && index === 0);

    const identity = document.createElement("div");
    identity.className = "identity";
    identity.dataset.color = color;

    const dot = document.createElement("span");
    dot.className = "dot";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = player ? player.name : "Open";
    identity.append(dot, name);

    const badges = document.createElement("div");
    badges.className = "badges";
    if (state.phase === "lobby") {
      badges.append(createBadge(String(index + 1)));
    }
    if (player?.id === playerId) {
      badges.append(createBadge("You"));
    }
    if (player && !online.includes(player.id)) {
      badges.append(createBadge("Away"));
    }
    if (state.turn === color && state.phase === "playing") {
      badges.append(createBadge("Now"));
    }

    row.setAttribute(
      "aria-label",
      `${colorLabels[color]} seat: ${player ? player.name : "open"}${state.turn === color ? ", current turn" : ""}`,
    );
    row.append(identity, badges);
    els.players.append(row);
  }
}

function displayMessage(me) {
  if (state.phase === "lobby") {
    return `${state.players.length}/4 seated`;
  }
  if (state.phase === "finished") {
    return state.winner === "tie" ? "Tie game" : "Game over";
  }
  if (!me) {
    return "Game in progress";
  }
  return me.color === state.turn ? "Your move" : "Waiting";
}

function renderRules() {
  const variant = normalizeVariant(state?.variant);
  const shared = `
    <p>Teams are paired dots. Partner discs are friendly and are never flipped.</p>
    <p>Captured enemy discs become the mover's color. The roster shows the current turn at the top.</p>
  `;
  const variantText = {
    standard: `
      <p><strong>Standard:</strong> you can close a capture line on either your own disc or your partner's disc.</p>
    `,
    "partner-anchor": `
      <p><strong>Partner-Anchor:</strong> your move must close a line on your partner's disc. Your own discs do not anchor captures.</p>
    `,
    "self-anchor": `
      <p><strong>Self-Anchor:</strong> your move must close a line on your own disc. Your partner's discs do not anchor captures.</p>
      <p>If your color has been wiped out, you can borrow your partner's anchors until you get discs back.</p>
    `,
  }[variant];

  els.rulesContent.innerHTML = `<h2>${variantLabels[variant]}</h2>${shared}${variantText}`;
}

function orderedTurns() {
  if (state.phase !== "playing") {
    return colors;
  }
  const start = colors.indexOf(state.turn);
  return [...colors.slice(start), ...colors.slice(0, start)];
}

function createBadge(text) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = text;
  return badge;
}

function score(board) {
  return colors.reduce((result, color) => {
    result[color] = board.filter((cell) => cell === color).length;
    return result;
  }, {});
}

function legalMoves(board, mover, variant = "standard") {
  return board.flatMap((cell, index) => (cell === null && captures(board, mover, index, variant).length > 0 ? [index] : []));
}

function captures(board, mover, moveIndex, variant = "standard") {
  if (board[moveIndex] !== null) {
    return [];
  }

  const moverTeam = teams[mover];
  const anchors = allowedAnchors(board, mover, variant);
  const startX = moveIndex % 8;
  const startY = Math.floor(moveIndex / 8);
  const found = [];

  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    const line = [];
    let x = startX + dx;
    let y = startY + dy;

    while (x >= 0 && x < 8 && y >= 0 && y < 8) {
      const currentIndex = y * 8 + x;
      const cell = board[currentIndex];
      if (!cell) {
        break;
      }
      if (teams[cell] === moverTeam) {
        if (line.length) {
          if (anchors.has(cell)) {
            found.push(...line);
          }
        }
        break;
      }
      line.push(currentIndex);
      x += dx;
      y += dy;
    }
  }

  return found;
}

function allowedAnchors(board, mover, variant) {
  const friendly = colors.filter((color) => teams[color] === teams[mover]);
  const teammate = friendly.find((color) => color !== mover);
  if (variant === "partner-anchor") {
    return new Set(teammate ? [teammate] : []);
  }
  if (variant === "self-anchor") {
    return new Set(board.includes(mover) || !teammate ? [mover] : [teammate]);
  }
  return new Set(friendly);
}

function normalizeVariant(variant) {
  if (variant === "partner-anchor" || variant === "experimental") {
    return "partner-anchor";
  }
  if (variant === "self-anchor") {
    return "self-anchor";
  }
  return "standard";
}

connect();
