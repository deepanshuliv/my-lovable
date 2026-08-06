const bashTool = {
  type: 'function',
  name: 'bash_tool',
  description: 'Tool to execute bash comand',
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

const askQuestion = {
  type: 'function',
  name: 'question_tool',
  description: 'question to ask to understand user intent',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'comand to execute in terminal',
      },
      options: { type: 'array', description: '4 options to aks the users clear intent' },
    },
    required: ['question', 'options'],
  },
};

export const allTools: any[] = [bashTool, askQuestion];
