import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./index";

interface WsClient {
  ws: WebSocket;
  username: string;
  sessionId: number;
}

// Map of sessionId → Set of connected clients (for workout sessions)
const sessions = new Map<number, Set<WsClient>>();

// Map of username → Set of WebSocket connections (for notifications/global)
const userConnections = new Map<string, Set<WebSocket>>();

export function sendToUser(username: string, message: object) {
  const connections = userConnections.get(username);
  if (!connections) return;

  const data = JSON.stringify(message);
  connections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

export function broadcastToSession(sessionId: number, message: object, exclude?: WebSocket) {
  const clients = sessions.get(sessionId);
  if (!clients) return;

  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.ws !== exclude && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  });
}

export function setupWebSocket(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    let registeredUsername: string | null = null;
    let client: WsClient | null = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Register user-level connection (for notifications)
        if (msg.type === "register") {
          const { username } = msg;
          if (!username) return;

          registeredUsername = username;
          if (!userConnections.has(username)) {
            userConnections.set(username, new Set());
          }
          userConnections.get(username)!.add(ws);

          log(`WebSocket: ${username} registered for notifications`, "ws");
          ws.send(JSON.stringify({ type: "registered", username }));
        }

        // Join a workout session
        if (msg.type === "join") {
          const { sessionId, username } = msg;
          if (!sessionId || !username) return;

          client = { ws, username, sessionId };

          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, new Set());
          }
          sessions.get(sessionId)!.add(client);

          log(`WebSocket: ${username} joined session ${sessionId}`, "ws");

          // Broadcast user-joined to all in session
          const participantCount = sessions.get(sessionId)!.size;
          broadcast(sessionId, {
            type: "user-joined",
            username,
            participantCount,
          });
        }

        // State update from creator → broadcast to all participants
        if (msg.type === "state-update" && client) {
          broadcast(client.sessionId, {
            type: "state-sync",
            serverTimestamp: Date.now(),
            payload: msg.payload,
          }, client.ws); // exclude sender
        }
      } catch (e) {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      // Clean up user connection
      if (registeredUsername) {
        const connections = userConnections.get(registeredUsername);
        if (connections) {
          connections.delete(ws);
          if (connections.size === 0) {
            userConnections.delete(registeredUsername);
          }
        }
        log(`WebSocket: ${registeredUsername} disconnected`, "ws");
      }

      // Clean up session connection
      if (client) {
        const sessionClients = sessions.get(client.sessionId);
        if (sessionClients) {
          sessionClients.delete(client);
          const participantCount = sessionClients.size;

          broadcast(client.sessionId, {
            type: "user-left",
            username: client.username,
            participantCount,
          });

          if (sessionClients.size === 0) {
            sessions.delete(client.sessionId);
          }
        }
      }
    });

    ws.on("error", () => {
      // Handled by close event
    });
  });

  log("WebSocket server attached on /ws", "ws");
  return wss;
}

function broadcast(sessionId: number, message: object, exclude?: WebSocket) {
  const clients = sessions.get(sessionId);
  if (!clients) return;

  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.ws !== exclude && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  });
}
