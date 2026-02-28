import express from 'express';
import cors from 'cors';
import path from 'path';
import routes from './routes';
import adminRoutes from './admin';
import { store } from './store';
import { sseManager } from './sse';

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
app.use('/admin', adminRoutes);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Start server
app.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/stream`);
  console.log(`Web UI: http://localhost:${PORT}/`);

  // Log admin token status
  if (process.env.ADMIN_TOKEN) {
    console.log('Admin API: CONFIGURED (token set)');
  } else {
    console.log('Admin API: NOT CONFIGURED (set ADMIN_TOKEN env var)');
  }

  // Periodic cleanup of inactive members (every 5 minutes, remove after 30 min inactive)
  setInterval(() => {
    const removed = store.cleanupInactiveMembers(30 * 60 * 1000);
    if (removed.length > 0) {
      console.log(`Cleaned up inactive members: ${removed.join(', ')}`);
      for (const name of removed) {
        sseManager.broadcastLeave(name);
      }
    }
  }, 5 * 60 * 1000);
});
