import type { Response } from 'express';
import { emitEvent } from '@repo/redis';
import { redactDeep, type EventType } from '@repo/shared';

export type Emitter = {
  projectId: string;
    emit: (type: EventType, payload: Record<string, unknown>) => Promise<number>;
    stream: (type: EventType, payload: Record<string, unknown>) => void;
    lastSeq: () => number;
  close: () => void;
};

export async function emitDetached(
  projectId: string,
  type: EventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await emitEvent(projectId, type, redactDeep(projectId, payload));
  } catch (error) {
    console.log('[DETACHED_EMIT_FAILED] , ', String(error).slice(0, 200));
  }
}

export function createEmitter(projectId: string, res: Response): Emitter {
  let closed = false;
  let highestSeq = 0;

  const write = (type: EventType, payload: Record<string, unknown>) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    } catch (error) {
      
      console.log('[SSE_WRITE] , ', String(error).slice(0, 120));
      closed = true;
    }
  };

  return {
    projectId,

    async emit(type, payload) {
      const safe = redactDeep(projectId, payload);
      write(type, safe);

      try {
        const event = await emitEvent(projectId, type, safe);
        highestSeq = Math.max(highestSeq, event.seq);
        return event.seq;
      } catch (error) {
        
        console.log('[STREAM_WRITE_FAILED] , ', String(error).slice(0, 200));
        return highestSeq;
      }
    },

    stream(type, payload) {
      write(type, redactDeep(projectId, payload));
    },

    lastSeq() {
      return highestSeq;
    },

    close() {
      if (closed) return;
      closed = true;
      if (!res.writableEnded) res.end();
    },
  };
}
