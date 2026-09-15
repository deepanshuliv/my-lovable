import { randomUUIDv7 } from 'bun';
import { prisma } from '@repo/db';
import { redact } from '@repo/shared';

export type RawToolOutput = {
  stdout: string;
  stderr?: string;
  exitCode?: number;
};

export type ToolOutputRecord = {
  id: string;
  taskId: string;
  sessionId: string;
  command?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  preview: string;
  truncated: boolean;
  byteLength: number;
  createdAt: string;
};

export type BoundedToolOutput = {
  text: string;
  outputId?: string;
  truncated: boolean;
  byteLength: number;
};

export interface ToolOutputRepository {
  save(record: ToolOutputRecord): Promise<ToolOutputRecord>;
  load(id: string): Promise<ToolOutputRecord | null>;
}

const INLINE_LIMIT = 12_000;
const PREVIEW_LIMIT = 8_000;
const EDGE_LIMIT = 3_200;

function bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function usefulLines(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => /error|failed|exception|warning|cannot find|not found|exit [1-9]/i.test(line))
    .slice(0, 24)
    .map((line) => line.slice(0, 500));
}

function boundedPreview(stdout: string, stderr: string): string {
  const combined = [stdout, stderr ? `\n[stderr]\n${stderr}` : ''].join('');
  if (combined.length <= INLINE_LIMIT) return combined;

  const head = combined.slice(0, EDGE_LIMIT);
  const tail = combined.slice(-EDGE_LIMIT);
  const errors = usefulLines(combined);
  const diagnostic = errors.length > 0 ? `\n[important diagnostics]\n${errors.join('\n')}` : '';
  return `${head}\n… [tool output externalized] …${diagnostic}\n${tail}`.slice(0, PREVIEW_LIMIT);
}

/** Keeps the model-facing observation bounded while retaining the raw result by id. */
export class ToolOutputManager {
  constructor(
    private readonly repository: ToolOutputRepository,
    private readonly inlineLimit = INLINE_LIMIT,
  ) {}

  async capture(
    taskId: string,
    sessionId: string,
    command: string | undefined,
    result: string | RawToolOutput,
  ): Promise<BoundedToolOutput> {
    const raw: RawToolOutput = typeof result === 'string' ? { stdout: result } : result;
    // Raw observations are durable, so apply the same project-scoped redaction used by
    // SSE/event payloads before writing them to the output store.
    const stdout = redact(taskId, raw.stdout ?? '');
    const stderr = redact(taskId, raw.stderr ?? '');
    const combined = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`;
    const byteLength = bytes(combined);

    if (combined.length <= this.inlineLimit) {
      return { text: combined, truncated: false, byteLength };
    }

    const id = randomUUIDv7();
    const record: ToolOutputRecord = {
      id,
      taskId,
      sessionId,
      command: command ? redact(taskId, command) : undefined,
      exitCode: raw.exitCode,
      stdout,
      stderr,
      preview: boundedPreview(stdout, stderr),
      truncated: true,
      byteLength,
      createdAt: new Date().toISOString(),
    };
    await this.repository.save(record);

    const exit = raw.exitCode === undefined ? '' : ` exit=${raw.exitCode}`;
    return {
      text: `${record.preview}\n[complete tool output available as output_id=${id}${exit}; retrieve it when needed]`,
      outputId: id,
      truncated: true,
      byteLength,
    };
  }

  async retrieve(id: string, start = 0, end?: number): Promise<string> {
    const record = await this.repository.load(id);
    if (!record) throw new Error(`tool output ${id} not found`);
    const combined = `${record.stdout}${record.stderr ? `\n[stderr]\n${record.stderr}` : ''}`;
    return combined.slice(Math.max(0, start), end);
  }
}

export class InMemoryToolOutputRepository implements ToolOutputRepository {
  private readonly records = new Map<string, ToolOutputRecord>();

  async save(record: ToolOutputRecord): Promise<ToolOutputRecord> {
    this.records.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async load(id: string): Promise<ToolOutputRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  size(): number {
    return this.records.size;
  }
}

export class PrismaToolOutputRepository implements ToolOutputRepository {
  async save(record: ToolOutputRecord): Promise<ToolOutputRecord> {
    const row = await prisma.toolOutput.create({
      data: {
        id: record.id,
        taskId: record.taskId,
        sessionId: record.sessionId,
        command: record.command,
        exitCode: record.exitCode,
        stdout: record.stdout,
        stderr: record.stderr,
        preview: record.preview,
        truncated: record.truncated,
        byteLength: record.byteLength,
        createdAt: new Date(record.createdAt),
      },
    });
    return { ...record, createdAt: row.createdAt.toISOString() };
  }

  async load(id: string): Promise<ToolOutputRecord | null> {
    const row = await prisma.toolOutput.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.taskId,
      sessionId: row.sessionId,
      command: row.command ?? undefined,
      exitCode: row.exitCode ?? undefined,
      stdout: row.stdout,
      stderr: row.stderr,
      preview: row.preview,
      truncated: row.truncated,
      byteLength: row.byteLength,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
