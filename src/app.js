import express from 'express';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { paths } from './config/paths.js';
import apiRouter from './routes/index.js';
import pageRouter from './routes/page.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initSimulation } from './services/simulation.service.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(paths.publicDir));

app.use(pageRouter);
app.use('/api', apiRouter);
app.use(errorHandler);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

initSimulation(io).catch(() => {
  console.error('โหลดข้อมูลเริ่มต้นจาก Supabase ไม่สำเร็จ เว็บยังเปิดได้ กรุณาตรวจการเชื่อมต่อและสถานะโปรเจกต์ Supabase แล้วกดเริ่มจำลองเพื่อลองใหม่');
});

export { app, httpServer, io };
