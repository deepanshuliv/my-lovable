import express, { type Request, type Response } from 'express';
import { runAgent } from './src/agent';
import { store } from './src/store/store';
import { connectToRedis } from './src/redis';

const app = express();
app.use(express.json());
await connectToRedis();

app.post('/chat/:projectId', (req: Request, res: Response) => {
  // AS POD STARTED get all the previosu chats from db
  const { projectId } = req.params;
  const { query } = req.body;
  if (!projectId && !query) {
    return res.status(400).json({
      msg: 'please provide valid projectId and query',
    });
  }

  // send server sent event
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // flush the headers to establish SSE with client
  runAgent(query, res);

  // If client closes connection, stop sending events
  res.on('close', () => {
    console.log('client dropped me');
    // may be write a way to drop the ai agent or no need to do that
    res.end();
  });
});

app.post('/answer/:questionId', async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const { answer } = req.body;

  if (!questionId) {
    return res.status(400).json({
      msg: 'please provide valid questionId',
    });
  }

  const questionResolver = store.get(questionId as string);

  // TODO as remove it becuase question answer should  be necessary , skip is a kind of optiion
  if (!questionResolver) {
    return res.status(400).json({
      msg: 'your time period to answer expire',
    });
  }

  console.log('▸ answer', questionId, answer);
  questionResolver(answer);
  store.delete(questionId as string);

  res.status(201).json({ msg: 'your response recorded succefully' });
});

app.listen(8000, () => {
  console.log('server is running on port 8000');
});
