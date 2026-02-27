import express from 'express';
import cors from 'cors';
import path from 'path';
import routes from './routes';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// API routes
app.use('/', routes);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Start server
app.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/stream`);
  console.log(`Web UI: http://localhost:${PORT}/`);
});
