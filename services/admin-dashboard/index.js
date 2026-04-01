const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.ADMIN_DASHBOARD_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all (serve index.html for client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎨 Admin Dashboard ready at http://localhost:${PORT}`);
  console.log(`📡 Make sure Admin API is running on http://localhost:4000`);
});
