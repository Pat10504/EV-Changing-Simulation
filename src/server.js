import { httpServer } from './app.js';
import { config } from './config/index.js';

httpServer.listen(config.port, () => {
  const now = new Date().toLocaleString('th-TH')
  console.log(`[${now}] Server running at http://localhost:${config.port}`)
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the old server or change PORT in .env.`)
    process.exit(1)
  }

  throw err
})
