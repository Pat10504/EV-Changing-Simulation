import { httpServer } from './app.js';
import { config } from './config/index.js';

httpServer.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}`);
});
