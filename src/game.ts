export const colors = ["red", "blue", "orange", "cyan"] as const;
export const warmColors = ["red", "orange"] as const;
export const coolColors = ["blue", "cyan"] as const;

export type DiscColor = (typeof colors)[number];
export type Team = "warm" | "cool";
export type Cell = DiscColor | null;
export type Phase = "lobby" | "playing" | "finished";

export interface Player {
  id: string;
  name: string;
  team: Team;
  color: DiscColor;
}

export interface GameState {
  phase: Phase;
  board: Cell[];
  players: Player[];
  turn: DiscColor;
  winner: Team | "tie" | null;
  message: string;
  updatedAt: number;
}

const directions = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

export function teamFor(color: DiscColor): Team {
  return color === "red" || color === "orange" ? "warm" : "cool";
}

export function teamColors(team: Team): DiscColor[] {
  return team === "warm" ? [...warmColors] : [...coolColors];
}

export function createInitialBoard(): Cell[] {
  const board = Array<Cell>(64).fill(null);
  board[indexOf(3, 3)] = "red";
  board[indexOf(4, 4)] = "orange";
  board[indexOf(3, 4)] = "blue";
  board[indexOf(4, 3)] = "cyan";
  return board;
}

export function createGameState(): GameState {
  return {
    phase: "lobby",
    board: createInitialBoard(),
    players: [],
    turn: "red",
    winner: null,
    message: "Waiting for two warm and two cool players.",
    updatedAt: Date.now(),
  };
}

export function indexOf(x: number, y: number): number {
  return y * 8 + x;
}

export function xyOf(index: number): [number, number] {
  return [index % 8, Math.floor(index / 8)];
}

export function getCaptures(board: Cell[], mover: DiscColor, moveIndex: number): number[] {
  if (moveIndex < 0 || moveIndex >= 64 || board[moveIndex] !== null) {
    return [];
  }

  const [startX, startY] = xyOf(moveIndex);
  const moverTeam = teamFor(mover);
  const captures: number[] = [];

  for (const [dx, dy] of directions) {
    const line: number[] = [];
    let x = startX + dx;
    let y = startY + dy;

    while (x >= 0 && x < 8 && y >= 0 && y < 8) {
      const currentIndex = indexOf(x, y);
      const cell = board[currentIndex];

      if (cell === null) {
        break;
      }

      if (teamFor(cell) === moverTeam) {
        if (line.length > 0) {
          captures.push(...line);
        }
        break;
      }

      line.push(currentIndex);
      x += dx;
      y += dy;
    }
  }

  return captures;
}

export function legalMoves(board: Cell[], mover: DiscColor): number[] {
  return board.flatMap((cell, index) => (cell === null && getCaptures(board, mover, index).length > 0 ? [index] : []));
}

export function cleanPlayerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 24) || "Player";
}

export function normalizePlayerName(name: string): string {
  return cleanPlayerName(name).toLocaleLowerCase();
}

export function joinTeam(state: GameState, id: string, name: string, team: Team, onlinePlayerIds = new Set<string>()): Player | null {
  const cleanName = cleanPlayerName(name);
  const existing = state.players.find((player) => player.id === id);

  if (existing) {
    existing.name = cleanName;
    return existing;
  }

  const sameName = state.players.find((player) => normalizePlayerName(player.name) === normalizePlayerName(cleanName));
  if (sameName) {
    if (onlinePlayerIds.has(sameName.id)) {
      return null;
    }
    sameName.id = id;
    sameName.name = cleanName;
    state.message =
      state.phase === "playing" ? `${labelColor(state.turn)} to move.` : "Waiting for two warm and two cool players.";
    return sameName;
  }

  if (state.phase !== "lobby") {
    return null;
  }

  const used = new Set(state.players.map((player) => player.color));
  const color = teamColors(team).find((candidate) => !used.has(candidate));
  if (!color) {
    return null;
  }

  const player = { id, name: cleanName, team, color };
  state.players.push(player);

  const warmReady = state.players.filter((player) => player.team === "warm").length === 2;
  const coolReady = state.players.filter((player) => player.team === "cool").length === 2;
  if (warmReady && coolReady) {
    state.phase = "playing";
    state.message = `${labelColor(state.turn)} to move.`;
  } else {
    state.message = "Waiting for two warm and two cool players.";
  }

  return player;
}

export function applyMove(state: GameState, playerId: string, moveIndex: number): boolean {
  if (state.phase !== "playing") {
    state.message = "The game has not started yet.";
    return false;
  }

  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.color !== state.turn) {
    state.message = `Waiting for ${labelColor(state.turn)}.`;
    return false;
  }

  const captures = getCaptures(state.board, player.color, moveIndex);
  if (captures.length === 0) {
    state.message = "That move does not capture any enemy discs.";
    return false;
  }

  state.board[moveIndex] = player.color;
  for (const capture of captures) {
    state.board[capture] = player.color;
  }

  advanceTurn(state);
  return true;
}

export function resetGame(state: GameState): void {
  state.board = createInitialBoard();
  state.phase = state.players.length === 4 ? "playing" : "lobby";
  state.turn = "red";
  state.winner = null;
  state.message = state.phase === "playing" ? "Red to move." : "Waiting for two warm and two cool players.";
}

export function score(state: GameState): Record<DiscColor, number> {
  return colors.reduce(
    (result, color) => {
      result[color] = state.board.filter((cell) => cell === color).length;
      return result;
    },
    {} as Record<DiscColor, number>,
  );
}

export function teamScore(state: GameState): Record<Team, number> {
  const current = score(state);
  return {
    warm: current.red + current.orange,
    cool: current.blue + current.cyan,
  };
}

export function labelColor(color: DiscColor): string {
  return color[0].toUpperCase() + color.slice(1);
}

function advanceTurn(state: GameState): void {
  const start = colors.indexOf(state.turn);

  for (let offset = 1; offset <= colors.length; offset += 1) {
    const next = colors[(start + offset) % colors.length];
    if (legalMoves(state.board, next).length > 0) {
      state.turn = next;
      state.message = `${labelColor(next)} to move.`;
      return;
    }
  }

  state.phase = "finished";
  const totals = teamScore(state);
  state.winner = totals.warm === totals.cool ? "tie" : totals.warm > totals.cool ? "warm" : "cool";
  state.message =
    state.winner === "tie"
      ? "Game finished in a tie."
      : `${state.winner === "warm" ? "Red + Orange" : "Blue + Cyan"} win.`;
}
