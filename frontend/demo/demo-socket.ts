import { Injectable } from '@angular/core';
import { MessageSocket } from '../src/app/shared/services/ws.service';
import { WebSocketData, WebSocketMessageType, WsMessage } from '../src/app/shared/models/websocket.model';

type Handler = (message: WsMessage<WebSocketData>) => void;

/**
 * Stands in for the socket.io connection. Nothing connects: the demo API
 * pushes the messages the server would broadcast after the same action.
 */
@Injectable({ providedIn: 'root' })
export class DemoSocket implements MessageSocket {
  private readonly _handlers = new Set<Handler>();

  on(_event: 'message', handler: Handler) {
    this._handlers.add(handler);
    return this;
  }

  off(_event: 'message', handler: Handler) {
    this._handlers.delete(handler);
    return this;
  }

  disconnect() {
    this._handlers.clear();
  }

  /** Delivered after the HTTP response, the order a real broadcast usually lands in. */
  push(type: WebSocketMessageType, data: unknown, delay = 0) {
    setTimeout(() => {
      const message = { type, data: structuredClone(data) as WebSocketData };

      this._handlers.forEach((handler) => handler(message));
    }, delay);
  }
}
