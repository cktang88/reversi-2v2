import { DurableObject } from "cloudflare:workers";
import { applyMove, createGameState, GameState, joinTeam, leaveSeat, resetGame, Team } from "./game";

interface Env {
  ASSETS: Fetcher;
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
}

type ClientMessage =
  | { type: "join"; playerId: string; name: string; team: Team }
  | { type: "leave"; playerId: string }
  | { type: "move"; playerId: string; index: number }
  | { type: "reset" };

interface SocketAttachment {
  playerId?: string;
}

export class GameRoom extends DurableObject<Env> {
  private state: GameState = createGameState();
  private initialized: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initialized = ctx.blockConcurrencyWhile(async () => {
      this.state = (await this.ctx.storage.get<GameState>("state")) ?? createGameState();
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialized;

    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json(this.view());
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({} satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "state", ...this.view() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.initialized;

    if (typeof message !== "string") {
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message) as ClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON message." }));
      return;
    }

    let changed = false;

    if (parsed.type === "join") {
      const player = joinTeam(this.state, parsed.playerId, parsed.name, parsed.team, this.onlinePlayerIds());
      if (player) {
        ws.serializeAttachment({ playerId: player.id } satisfies SocketAttachment);
        changed = true;
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "That team is full, the username is active, or the game has already started.",
          }),
        );
      }
    }

    if (parsed.type === "move") {
      changed = applyMove(this.state, parsed.playerId, parsed.index);
    }

    if (parsed.type === "leave") {
      changed = leaveSeat(this.state, parsed.playerId);
      if (changed) {
        ws.serializeAttachment({} satisfies SocketAttachment);
      }
    }

    if (parsed.type === "reset") {
      resetGame(this.state);
      changed = true;
    }

    if (changed) {
      await this.saveAndBroadcast();
    }
  }

  webSocketClose(): void {
    this.broadcast();
  }

  webSocketError(): void {
    this.broadcast();
  }

  private async saveAndBroadcast(): Promise<void> {
    this.state.updatedAt = Date.now();
    await this.ctx.storage.put("state", this.state);
    this.broadcast();
  }

  private broadcast(): void {
    const payload = JSON.stringify({ type: "state", ...this.view() });
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(payload);
    }
  }

  private view() {
    const online = this.onlinePlayerIds();

    return {
      state: this.state,
      online: [...online],
    };
  }

  private onlinePlayerIds(): Set<string> {
    return new Set(
      this.ctx
        .getWebSockets()
        .map((socket) => (socket.deserializeAttachment() as SocketAttachment | undefined)?.playerId)
        .filter((id): id is string => Boolean(id)),
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(`${url.origin}/room/${crypto.randomUUID()}`, 302);
    }

    if (url.pathname.startsWith("/ws/")) {
      const roomId = url.pathname.slice("/ws/".length);
      if (!roomId || request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket room request.", { status: 400 });
      }
      return env.GAME_ROOMS.getByName(roomId).fetch(request);
    }

    if (url.pathname.startsWith("/api/room/")) {
      const roomId = url.pathname.slice("/api/room/".length);
      return env.GAME_ROOMS.getByName(roomId).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
