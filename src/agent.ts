import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT } from './sytemPrompt';
import { allTools } from './tools/toolSchema';
import { toolCall } from './tools/toolDefintion';
import { randomUUIDv7 } from 'bun';
import { writeToStream } from './redis';

const ai = new GoogleGenAI({});

export async function runAgent(query: string, res?: any) {
  let nextInput: any[] = [
    {
      type: 'user_input',
      content: [
        {
          text: query,
          type: 'text',
        },
      ],
    },
  ];

  // TODO :- add to redis user query with type "USER_QUERY"
  let previousInteractionId: string | undefined;

  console.log('▸ start', query);

  while (1) {
    const stream = await ai.interactions.create({
      model: 'gemini-3.5-flash',
      input: nextInput,
      previous_interaction_id: previousInteractionId,
      stream: true,
      tools: allTools,
      system_instruction: SYSTEM_PROMPT,
    });

    // Results produced during this turn, sent back on the next turn.
    const toolResults: any[] = [];
    let currentTool: { name: keyof typeof toolCall; id: string } | null = null;
    let flagToStop = false;
    let counter = 0;
    for await (const event of stream) {
      console.log('[RESPONSE', ++counter, '] ', event);

      if (event.event_type === 'step.start' && event.step.type === 'function_call') {
        currentTool = { name: event.step.name as keyof typeof toolCall, id: event.step.id };
      }

      if (event.event_type === 'step.delta' && event.delta.type === 'arguments_delta') {
        if (!event.delta.arguments || !currentTool) {
          continue;
        }
        const parseArg = JSON.parse(event.delta.arguments);

        //  add to redis with type "TOOL_CALL"
        const currentToolWithArg = { ...currentTool, arguments: parseArg, type: 'function_call' };
        await writeToStream(currentToolWithArg);

        console.log(`\n⚙ ${currentTool.name}  ${parseArg.comand ?? JSON.stringify(parseArg)}`);
        res.write(
          `data: ${JSON.stringify({ type: 'tool_call', name: currentTool.name, args: parseArg })}\n\n`,
        );

        const toolResult = await runAppropriateTool(parseArg, currentTool, res);
        // TODO:- add to redis tool result with type "TOOL_RESULT"
        const toolResultResponse = {
          type: 'function_result',
          call_id: currentTool.id,
          is_error: toolResult.includes('ERROR') ? true : false,
          name: currentTool.name,
          result: toolResult,
        };

        await writeToStream(toolResultResponse);
        toolResults.push(toolResultResponse);

        console.log(`✓ result\n${toolResult || '(empty)'}`);
        res.write(
          `data: ${JSON.stringify({ type: 'tool_result', name: currentTool.name, toolResult })}\n\n`,
        );
      }

      if (event.event_type === 'step.delta' && event.delta.type === 'text') {
        // TODO :- add to redis with type "TEXT"

        console.log('▸ text', event.delta.text);
        res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
      }

      if (event.event_type === 'interaction.completed') {
        // Chain the next turn to this interaction so the model sees prior context.
        previousInteractionId = event.interaction.id;

        if (event.interaction.status === 'requires_action') {
          console.log('▸ running');
          res.write(`data: ${JSON.stringify({ type: 'running' })}\n\n`);
          break;
        }
        // completed | failed | cancelled | incomplete -> the agent is finished.
        console.log('▸ done', event.interaction.status);
        flagToStop = true;
        res.end();
        break;
      }
    }

    if (flagToStop) break;

    nextInput = toolResults;
  }
}

async function runAppropriateTool(args: any, toolDetail: any, res?: any) {
  let toolResult = '';
  if (toolDetail.name == 'bash_tool') {
    toolResult = (await toolCall.bash_tool(args.comand)) as string;
  } else if (toolDetail.name === 'question_tool') {
    const correlationId = randomUUIDv7();
    const { question, options } = args;
    console.log('▸ question', question, options);
    res.write(
      `data: ${JSON.stringify({ type: 'question', questionId: correlationId, question, options })}\n\n`,
    );
    const answer = (await toolCall.question_tool(correlationId)) as string;
    console.log('▸ answer received', answer);
    toolResult = String(answer ?? '');
  }

  return toolResult;
}
