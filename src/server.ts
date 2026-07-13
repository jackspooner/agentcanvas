import { startAgentCanvas } from './server-v2.js';

startAgentCanvas().catch((error) => {
  console.error(error);
  process.exit(1);
});
