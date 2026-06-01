const colors = ["red", "blue", "orange", "cyan"];
const colorLabels = { red: "Red", orange: "Orange", blue: "Blue", cyan: "Cyan" };
const teamLabels = { warm: "Red + Orange", cool: "Blue + Cyan" };
const teams = { red: "warm", orange: "warm", blue: "cool", cyan: "cool" };

const els = {
  board: document.querySelector("#board"),
  connection: document.querySelector("#connection"),
  copyLink: document.querySelector("#copyLink"),
  joinForm: document.querySelector("#joinForm"),
  message: document.querySelector("#message"),
  players: document.querySelector("#players"),
  resetGame: document.querySelector("#resetGame"),
  roomLabel: document.querySelector("#roomLabel"),
  teamChoices: [...document.querySelectorAll(".teamChoice")],
  turnOrder: document.querySelector("#turnOrder"),
  username: document.querySelector("#username"),
  warmScore: document.querySelector("#warmScore"),
  coolScore: document.querySelector("#coolScore"),
};

const roomId = location.pathname.split("/").filter(Boolean).at(-1);
let selectedTeam = "warm";
let socket;
let state;
let online = [];
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
  send({ type: "reset" });
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

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws/${roomId}`);

  socket.addEventListener("open", () => {
    els.connection.textContent = "Connected";
    const name = els.username.value.trim();
    if (name) {
      send({ type: "join", playerId, name, team: selectedTeam });
    }
  });

  socket.addEventListener("close", () => {
    els.connection.textContent = "Disconnected. Reconnecting...";
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
  const legal = new Set(me?.color === state.turn && state.phase === "playing" ? legalMoves(state.board, me.color) : []);
  const counts = score(state.board);

  els.message.textContent = state.message;
  els.warmScore.textContent = String(counts.red + counts.orange);
  els.coolScore.textContent = String(counts.blue + counts.cyan);
  els.joinForm.hidden = Boolean(me) || state.phase !== "lobby";
  els.resetGame.disabled = !state.players.some((player) => player.id === playerId);

  els.board.innerHTML = "";
  state.board.forEach((cell, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cell";
    button.disabled = !legal.has(index);
    button.classList.toggle("legal", legal.has(index));
    button.setAttribute("aria-label", cell ? `${colorLabels[cell]} disc` : `Empty square ${index + 1}`);

    if (cell) {
      const disc = document.createElement("span");
      disc.className = "disc";
      disc.dataset.color = cell;
      button.append(disc);
    }

    if (legal.has(index)) {
      button.addEventListener("click", () => send({ type: "move", playerId, index }));
    }

    els.board.append(button);
  });

  renderPlayers();
  renderTurnOrder();
}

function renderPlayers() {
  els.players.innerHTML = "";
  for (const color of colors) {
    const player = state.players.find((candidate) => candidate.color === color);
    const row = document.createElement("div");
    row.className = "player";

    const identity = document.createElement("div");
    identity.className = "identity";
    identity.dataset.color = color;

    const dot = document.createElement("span");
    dot.className = "dot";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = player ? player.name : "Open seat";
    identity.append(dot, name);

    const meta = document.createElement("small");
    const parts = [colorLabels[color], teamLabels[teams[color]]];
    if (player?.id === playerId) {
      parts.push("you");
    }
    if (player && !online.includes(player.id)) {
      parts.push("offline");
    }
    if (state.turn === color && state.phase === "playing") {
      parts.push("turn");
    }
    meta.textContent = parts.join(" · ");

    row.append(identity, meta);
    els.players.append(row);
  }
}

function renderTurnOrder() {
  els.turnOrder.innerHTML = "";
  for (const color of colors) {
    const player = state.players.find((candidate) => candidate.color === color);
    const item = document.createElement("div");
    item.className = "turnItem";
    item.dataset.color = color;
    item.classList.toggle("active", state.phase === "playing" && state.turn === color);

    const dot = document.createElement("span");
    dot.className = "dot";
    const label = document.createElement("span");
    label.textContent = player ? `${colorLabels[color]} · ${player.name}` : colorLabels[color];

    item.append(dot, label);
    els.turnOrder.append(item);
  }
}

function score(board) {
  return colors.reduce((result, color) => {
    result[color] = board.filter((cell) => cell === color).length;
    return result;
  }, {});
}

function legalMoves(board, mover) {
  return board.flatMap((cell, index) => (cell === null && captures(board, mover, index).length > 0 ? [index] : []));
}

function captures(board, mover, moveIndex) {
  if (board[moveIndex] !== null) {
    return [];
  }

  const moverTeam = teams[mover];
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
          found.push(...line);
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

connect();
