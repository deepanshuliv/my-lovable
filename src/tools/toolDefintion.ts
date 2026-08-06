import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { store } from '../store/store';

const exec = promisify(execCallback);

async function runBashTool(comand: string) {
  try {
    const { stderr, stdout } = await exec(comand);
    if (stderr) {
      return stderr;
    }
    return stdout.trimEnd();
  } catch (error) {
    return `ERROR: ${error}`;
  }
}
async function askQuestion(correlationId: string) {
  return new Promise((resolve: any, reject: any) => {
    setTimeout(() => {
      store.delete(correlationId);
      reject('timeOut error');
    }, 10_00_000);
    store.set(correlationId, resolve);
  });
}

export const toolCall = {
  bash_tool: runBashTool,
  question_tool: askQuestion,
};
