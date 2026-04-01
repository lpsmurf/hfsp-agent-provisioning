# Telegram Web App Deployment Guide

## Production Build Ready ✅

The webapp is built and ready to deploy at:
```
services/webapp/dist/
```

**Build Size:**
- HTML: 0.82 KB
- CSS: 3.75 KB (gzip)
- JS: 78.38 KB (gzip)
- **Total: ~83 KB** (highly optimized)

---

## Deployment Options

### **Option 1: Deploy to Hostinger VPS (Recommended)**

If using Hostinger VPS with your HFSP infrastructure:

**Step 1: Upload Files**
```bash
# From your local machine, upload the dist folder:
scp -r services/webapp/dist/ user@your-vps-ip:/var/www/telegram-webapp/
```

**Step 2: Set Up Nginx**
```nginx
server {
    listen 443 ssl http2;
    server_name app.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    root /var/www/telegram-webapp/dist;
    index index.html;
    
    # Proxy API requests to your backend
    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # WebSocket support for real-time provisioning
    location /api/provisioning/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # SPA routing - all requests to index.html
    location / {
        try_files $uri /index.html;
    }
    
    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Step 3: Restart Nginx**
```bash
sudo systemctl restart nginx
```

---

### **Option 2: Docker Deployment**

**Create Dockerfile:**
```dockerfile
FROM node:20-alpine as builder
WORKDIR /app
COPY services/webapp .
RUN npm ci && npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Deploy:**
```bash
docker build -t hfsp-telegram-app .
docker run -d \
  -p 80:80 \
  -e API_URL=http://your-api:4000 \
  --name telegram-app \
  hfsp-telegram-app
```

---

### **Option 3: Simple HTTP Server (Quick Testing)**

For temporary testing:
```bash
# Install simple HTTP server
npm install -g http-server

# Run from dist directory
cd services/webapp/dist
http-server -p 8080 -c-1

# Access at http://localhost:8080
```

---

## Environment Configuration

Create `.env` in webapp root for build-time configuration:

```bash
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_APP_NAME=HFSP Agent Provisioner
VITE_APP_VERSION=1.0.0
```

Then rebuild:
```bash
npm run build
```

---

## Telegram Bot Configuration

Update your @hfsp_agent_bot with the web app URL:

**Using Telegram BotFather:**
```
/setmenubutton
Select your bot
Web App
https://app.yourdomain.com
```

Or via API:
```bash
curl -X POST \
  https://api.telegram.org/bot<BOT_TOKEN>/setChatMenuButton \
  -H "Content-Type: application/json" \
  -d '{
    "menu_button": {
      "type": "web_app",
      "text": "Open App",
      "web_app": {
        "url": "https://app.yourdomain.com"
      }
    }
  }'
```

---

## Backend API Requirements

Ensure your backend API (`http://localhost:4000`) has:

**1. Telegram Authentication Endpoint**
```
POST /api/webapp/auth
Body: { "initData": "<telegram_init_data>" }
Response: { "token": "<jwt>", "expires_in": 3600, "user": {...} }
```

**2. Agent Management Endpoints**
- `GET /api/agents` - List agents
- `POST /api/agents` - Create agent
- `PATCH /api/agents/:id` - Update agent
- `DELETE /api/agents/:id` - Delete agent

**3. WebSocket Endpoint**
```
WS /api/provisioning/:tenantId
Messages: { "type": "provisioning.status", "data": {...} }
```

**4. CORS Configuration**
```javascript
app.use(cors({
  origin: 'https://app.yourdomain.com',
  credentials: true
}));
```

---

## SSL Certificate Setup

For production HTTPS (required by Telegram):

**Option A: Let's Encrypt (Free)**
```bash
sudo certbot certonly --standalone -d app.yourdomain.com
```

**Option B: Hostinger SSL**
Use Hostinger's built-in SSL certificate management.

---

## Testing in Telegram

Once deployed:

1. **Open Telegram**
2. **Search for @hfsp_agent_bot**
3. **Tap the "Open App" button**
4. **App opens in full-screen Telegram Mini App**

---

## Monitoring & Logs

Monitor webapp deployment:

```bash
# Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Docker logs (if using Docker)
docker logs -f telegram-app

# Check webapp health
curl https://app.yourdomain.com/
```

---

## CI/CD Pipeline (Optional)

Automate deployments with GitHub Actions:

```yaml
name: Deploy Webapp
on:
  push:
    branches: [main]
    paths: ['services/webapp/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: cd services/webapp && npm ci && npm run build
      - run: scp -r services/webapp/dist/ user@vps:/var/www/telegram-webapp/
```

---

## Troubleshooting

**Issue: "Telegram Web App SDK not loaded"**
- Ensure Telegram app is opening the URL, not a regular browser
- Check that domain is HTTPS (required by Telegram)

**Issue: API requests failing**
- Verify backend API is running on port 4000
- Check CORS headers in backend
- Verify JWT token refresh endpoint works

**Issue: WebSocket not connecting**
- Check firewall allows WebSocket connections
- Verify proxy_upgrade headers in Nginx
- Test with: `wscat -c wss://app.yourdomain.com/api/provisioning/tenant123`

**Issue: Blank page in Telegram**
- Open in browser first to verify no errors
- Check browser console for errors
- Verify index.html is being served correctly

---

## Performance Tips

✅ **Already optimized:**
- Code splitting (Vite)
- Tree-shaking
- CSS purging (Tailwind)
- Gzip compression
- Cache-busting with hashes

**Additional optimizations:**
```nginx
# Add gzip compression
gzip on;
gzip_types text/plain text/css application/javascript;
gzip_min_length 1000;

# Add security headers
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
```

---

## Next Steps

1. **Choose deployment method** (VPS, Docker, etc.)
2. **Set up SSL certificate** (Let's Encrypt or Hostinger)
3. **Configure Nginx/server**
4. **Update bot settings** in BotFather
5. **Test in Telegram app**
6. **Monitor logs** for any issues

---

**Ready to deploy?** Let me know your VPS provider and domain, and I can help with the specific setup!
