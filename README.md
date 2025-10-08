# Makeable - AI App Builder

🚀 **If you can imagine it, we can make it.**

Makeable is an AI-powered app builder that transforms your ideas into functional web applications using Claude AI.

## Features

- 🤖 AI-powered app generation using Claude
- 👤 User authentication and project management
- 💾 Save and manage multiple projects
- 🔄 Iterate and improve existing projects
- 📱 PWA support for mobile devices
- 🎨 Beautiful gradient UI with animations

## Tech Stack

- **Backend:** Node.js, Express, TypeScript
- **AI:** Anthropic Claude SDK
- **Auth:** JWT, bcrypt
- **Frontend:** Vanilla JS, HTML, CSS

## Deployment

### Railway

1. Fork this repository
2. Connect to Railway
3. Add environment variables:
   - `ANTHROPIC_API_KEY` - Your Anthropic API key
   - `JWT_SECRET` - Random secret for JWT tokens
4. Deploy!

### Environment Variables

```env
ANTHROPIC_API_KEY=your_api_key_here
JWT_SECRET=your_secret_here
PORT=3000
```

## Local Development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`

## License

MIT
