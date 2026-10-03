import type { ToolSpec } from '../providers/types';

const writeFile: ToolSpec = {
  name: 'write_file',
  description:
    'Write or create a complete file at the specified path. Parent directories are created automatically if they do not exist. Use this tool when creating a new file or replacing the entire content of a small file.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file inside the project workspace, e.g. components/Header.tsx or app/page.tsx',
      },
      content: {
        type: 'string',
        description: 'The exact code or text content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
};

const editFile: ToolSpec = {
  name: 'edit_file',
  description:
    'Surgically update an existing file by replacing target_content with replacement_content. Saves massive tokens and execution time because you only output the specific lines to change instead of rewriting the entire file.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the existing file to modify',
      },
      target_content: {
        type: 'string',
        description: 'The exact existing block of code in the file that you wish to replace. Must match the file content exactly.',
      },
      replacement_content: {
        type: 'string',
        description: 'The new replacement code to put in place of target_content',
      },
    },
    required: ['path', 'target_content', 'replacement_content'],
  },
};

const readFile: ToolSpec = {
  name: 'read_file',
  description:
    'Read the contents of a file with line numbers. You can specify start_line and end_line to inspect specific sections and save context tokens.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file to read',
      },
      start_line: {
        type: 'integer',
        description: 'Optional 1-indexed starting line number',
      },
      end_line: {
        type: 'integer',
        description: 'Optional 1-indexed ending line number',
      },
    },
    required: ['path'],
  },
};

const listDir: ToolSpec = {
  name: 'list_dir',
  description:
    'List project files and directories in a clean, compact view. Automatically excludes node_modules, .next, and git folders to preserve context.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Optional directory path to list (defaults to project root .)',
      },
    },
  },
};

const searchCode: ToolSpec = {
  name: 'search_code',
  description:
    'Fast search for exact keywords, symbols, functions, or regex patterns across the codebase without reading entire files into context.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The text or pattern to search for in files',
      },
      path: {
        type: 'string',
        description: 'Optional directory path to search in (defaults to .)',
      },
      include: {
        type: 'string',
        description: 'Optional file glob filter, e.g. *.tsx or *.ts',
      },
    },
    required: ['query'],
  },
};

const readToolOutput: ToolSpec = {
  name: 'read_tool_output',
  description:
    'Only for tool results that explicitly contain output_id=...: retrieve a bounded slice of that stored output using that exact id. Never invent an id. A negative start reads from the end.',
  parameters: {
    type: 'object',
    properties: {
      output_id: { type: 'string', description: 'The output_id included in the truncated tool result' },
      start: { type: 'integer', description: 'Optional character offset (default 0). Negative values count from the end, e.g. -2000 for the last 2000 characters.' },
      end: { type: 'integer', description: 'Optional exclusive character offset' },
    },
    required: ['output_id'],
  },
};

const findImages: ToolSpec = {
  name: 'find_images',
  description:
    'Search for real, public-domain (CC0) photos for the app. Returns direct image URLs that are free to use with no attribution. Call it ONCE with every subject you need in `queries` (e.g. ["candle jar", "candle flame", "lavender field"]); they are searched in parallel. Use only URLs it returns.',
  parameters: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 6 photo subjects, each 1 to 3 plain words',
      },
      orientation: { type: 'string', enum: ['landscape', 'portrait', 'square'], description: 'Optional preferred shape' },
    },
    required: ['queries'],
  },
};

const bashTool: ToolSpec = {
  name: 'bash_tool',
  description:
    'Execute a bash command inside the project sandbox. Use for running npm installs, package additions, database migrations, git operations, or build checks. Never refuse a command because its output may be long; long output is shortened automatically.',
  parameters: {
    type: 'object',
    properties: {
      comand: {
        type: 'string',
        description: 'comand to execute in terminal',
      },
    },
    required: ['comand'],
  },
};

const askQuestion: ToolSpec = {
  name: 'question_tool',
  description:
    'Ask the user every clarifying question you need in ONE call (1 to 5 questions; at most 5 per turn). Each has a question and short options. You receive all answers together.',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        description: '1 to 5 questions, asked in this order.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'One clear question.' },
            options: { type: 'array', items: { type: 'string' }, description: '4 short options covering the likely answers.' },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  },
};

const requestApiKeys: ToolSpec = {
  name: 'request_api_keys',
  description:
    'Ask the user for every API key a third-party service in this build needs (AI models, payments, email, SMS, paid data APIs), BEFORE writing any code. Blocks until the user answers. The platform checks each key with the real provider and saves them as environment variables only when they work. Returns VERIFIED (build the full feature), DESIGN_ONLY (build the frontend only), or STOP (build nothing). Never use it for a database in the first version.',
  parameters: {
    type: 'object',
    properties: {
      service: {
        type: 'string',
        description: 'plain-language name of what needs the keys, e.g. "the AI chat assistant and card payments"',
      },
      keys: {
        type: 'array',
        description: 'every environment variable this build needs, all in one call',
        items: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'environment variable name, e.g. OPENAI_API_KEY',
            },
            reason: {
              type: 'string',
              description: 'one short plain-language line on what it powers, for a non-technical reader',
            },
          },
          required: ['key', 'reason'],
        },
      },
    },
    required: ['service', 'keys'],
  },
};

const allTools: ToolSpec[] = [
  writeFile,
  editFile,
  readFile,
  listDir,
  searchCode,
  readToolOutput,
  findImages,
  bashTool,
  askQuestion,
  requestApiKeys,
];

export function toolsForMode(mode: 'plan' | 'build'): ToolSpec[] {
  return mode === 'plan'
    ? [readFile, listDir, searchCode, readToolOutput, bashTool, askQuestion]
    : allTools;
}
