// Runs the demo API on a real port: `npm start`, then try it with curl.
import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const app = buildApp({ logger: true });
await app.listen({ port, host: '127.0.0.1' });
