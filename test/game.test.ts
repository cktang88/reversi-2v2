import { describe, expect, it } from "vitest";
import { applyMove, createGameState, getCaptures, indexOf, joinTeam, leaveSeat, legalMoves, resetGame } from "../src/game";

describe("cross-capture rules", () => {
  it("allows a partner disc to terminate a capture line", () => {
    const state = createGameState();
    state.board = Array(64).fill(null);
    state.board[indexOf(0, 0)] = "orange";
    state.board[indexOf(1, 0)] = "blue";
    state.board[indexOf(2, 0)] = "cyan";

    expect(getCaptures(state.board, "red", indexOf(3, 0))).toEqual([indexOf(2, 0), indexOf(1, 0)]);
  });

  it("does not flip partner discs inside the endpoint", () => {
    const state = createGameState();
    state.board = Array(64).fill(null);
    state.board[indexOf(0, 0)] = "red";
    state.board[indexOf(1, 0)] = "blue";
    state.board[indexOf(2, 0)] = "orange";

    expect(getCaptures(state.board, "red", indexOf(3, 0))).toEqual([]);
  });

  it("standard rules allow self or partner anchors", () => {
    const state = createGameState();
    state.board = Array(64).fill(null);
    state.board[indexOf(0, 0)] = "red";
    state.board[indexOf(1, 0)] = "blue";
    expect(getCaptures(state.board, "red", indexOf(2, 0), "standard")).toEqual([indexOf(1, 0)]);

    state.board[indexOf(0, 1)] = "orange";
    state.board[indexOf(1, 1)] = "cyan";
    expect(getCaptures(state.board, "red", indexOf(2, 1), "standard")).toEqual([indexOf(1, 1)]);
  });

  it("experimental rules allow partner anchors but not self anchors", () => {
    const state = createGameState();
    state.board = Array(64).fill(null);
    state.board[indexOf(0, 0)] = "red";
    state.board[indexOf(1, 0)] = "blue";
    state.board[indexOf(0, 1)] = "orange";
    state.board[indexOf(1, 1)] = "cyan";

    expect(getCaptures(state.board, "red", indexOf(2, 0), "experimental")).toEqual([]);
    expect(getCaptures(state.board, "red", indexOf(2, 1), "experimental")).toEqual([indexOf(1, 1)]);
  });

  it("experimental rules let a wiped-out player borrow teammate anchors", () => {
    const state = createGameState();
    state.board = Array(64).fill(null);
    state.board[indexOf(0, 0)] = "orange";
    state.board[indexOf(1, 0)] = "blue";

    expect(state.board.includes("red")).toBe(false);
    expect(legalMoves(state.board, "red", "experimental")).toContain(indexOf(2, 0));
  });

  it("starts once each team has two players", () => {
    const state = createGameState();
    joinTeam(state, "a", "Ada", "warm");
    joinTeam(state, "b", "Ben", "warm");
    joinTeam(state, "c", "Cam", "cool");
    joinTeam(state, "d", "Dee", "cool");

    expect(state.phase).toBe("playing");
    expect(state.players.map((player) => player.color)).toEqual(["red", "orange", "blue", "cyan"]);
    expect(legalMoves(state.board, "red").length).toBeGreaterThan(0);
  });

  it("lets an offline player reclaim their seat by username after the game starts", () => {
    const state = createGameState();
    joinTeam(state, "old-a", "Ada Lovelace", "warm");
    joinTeam(state, "b", "Ben", "warm");
    joinTeam(state, "c", "Cam", "cool");
    joinTeam(state, "d", "Dee", "cool");

    const player = joinTeam(state, "new-a", " ada   lovelace ", "cool", new Set(["b", "c", "d"]));

    expect(player?.color).toBe("red");
    expect(player?.team).toBe("warm");
    expect(player?.id).toBe("new-a");
    expect(state.phase).toBe("playing");
  });

  it("does not let a second connection claim an active username", () => {
    const state = createGameState();
    joinTeam(state, "active-a", "Ada", "warm");

    expect(joinTeam(state, "new-a", "Ada", "warm", new Set(["active-a"]))).toBeNull();
  });

  it("clears a seat without resetting board state", () => {
    const state = createGameState();
    joinTeam(state, "a", "Ada", "warm");
    joinTeam(state, "b", "Ben", "warm");
    joinTeam(state, "c", "Cam", "cool");
    joinTeam(state, "d", "Dee", "cool");
    state.board[indexOf(0, 0)] = "red";

    expect(leaveSeat(state, "a")).toBe(true);
    expect(state.phase).toBe("lobby");
    expect(state.players.map((player) => player.id)).toEqual(["b", "c", "d"]);
    expect(state.board[indexOf(0, 0)]).toBe("red");
  });

  it("records and clears the last placed square", () => {
    const state = createGameState();
    joinTeam(state, "a", "Ada", "warm");
    joinTeam(state, "b", "Ben", "warm");
    joinTeam(state, "c", "Cam", "cool");
    joinTeam(state, "d", "Dee", "cool");
    const move = legalMoves(state.board, "red")[0];

    expect(applyMove(state, "a", move)).toBe(true);
    expect(state.lastMove).toBe(move);

    resetGame(state);
    expect(state.lastMove).toBeNull();
  });

  it("reset can switch rulesets", () => {
    const state = createGameState();
    resetGame(state, "experimental");
    expect(state.variant).toBe("experimental");
    resetGame(state, "standard");
    expect(state.variant).toBe("standard");
  });
});
