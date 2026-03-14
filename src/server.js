import { httpServer } from './app.js';
import { config } from './config/index.js';

httpServer.listen(config.port, () => {
  const now = new Date().toLocaleString('th-TH')
  console.log(`[${now}] Server running at http://localhost:${config.port}`)
});
