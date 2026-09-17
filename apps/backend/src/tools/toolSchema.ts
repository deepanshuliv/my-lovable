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
    'Retrieve a bounded slice of a previously externalized large tool result using its output_id. Use start/end character offsets when you need another portion.',
  parameters: {
    type: 'object',
    properties: {
      output_id: { type: 'string', description: 'The output_id included in the truncated tool result' },
      start: { type: 'integer', description: 'Optional zero-based character offset (default 0)' },
      end: { type: 'integer', description: 'Optional exclusive character offset' },
    },
    required: ['output_id'],
  },
};

const bashTool: ToolSpec = {
  name: 'bash_tool',
  description:
    'Execute a bash command inside the project sandbox. Use for running npm installs, package additions, database migrations, git operations, or build checks.',
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
  description: 'question to ask to understand user intent',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'the question to put to the user',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '4 options to ask the user clear intent',
      },
    },
    required: ['question', 'options'],
  },
};

const declareRequiredSecrets: ToolSpec = {
  name: 'declare_required_secrets',
  description:
    'Declare environment variables this project needs in order to work, e.g. an API key or a database url. Give the variable name and why it is needed — never a value. Call this as soon as you know a credential is needed; the user is shown the collected list when the turn ends. Returns immediately and does not wait for the user.',
  parameters: {
    type: 'object',
    properties: {
      secrets: {
        type: 'array',
        description: 'the environment variables this project needs',
        items: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'environment variable name, e.g. STRIPE_SECRET_KEY',
            },
            reason: {
              type: 'string',
              description: 'one short line on what it is for',
            },
          },
          required: ['key', 'reason'],
        },
      },
    },
    required: ['secrets'],
  },
};

const allTools: ToolSpec[] = [
  writeFile,
  editFile,
  readFile,
  listDir,
  searchCode,
  readToolOutput,
  bashTool,
  askQuestion,
  declareRequiredSecrets,
];

export function toolsForMode(mode: 'plan' | 'build'): ToolSpec[] {
  return mode === 'plan'
    ? [readFile, listDir, searchCode, bashTool, askQuestion, declareRequiredSecrets]
    : allTools;
}
