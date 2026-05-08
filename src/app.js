import express from 'express';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initSimulation } from './services/simulation.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes
import apiRouter from './routes/index.js';
app.use('/api', apiRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    message: err.message || 'เกิดข้อผิดพลาดภายในระบบ',
  });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// เริ่ม simulation service (โหลด CSV ไว้รอ)
initSimulation(io);

export { app, httpServer, io };
