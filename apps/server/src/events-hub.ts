import type { WebSocket } from 'ws'
import { HEARTBEAT_INTERVAL_MS, type ServerEvent } from '@theama/contracts'

/** Fan-out of server events to every connected WebSocket client. */
export class EventsHub {
  private readonly sockets = new Set<WebSocket>()
  private timer: NodeJS.Timeout | null = null

  get clientCount(): number {
    return this.sockets.size
  }

  add(socket: WebSocket): void {
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => this.sockets.delete(socket))
  }

  broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event)
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload)
    }
  }

  startHeartbeat(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.broadcast({ type: 'heartbeat', time: new Date().toISOString() })
    }, HEARTBEAT_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const socket of this.sockets) socket.close(1001, 'server shutting down')
    this.sockets.clear()
  }
}
