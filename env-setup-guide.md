# 🔧 CLARYFY ENVIRONMENT SETUP GUIDE

## Backend Environment Variables (.env)

Create a `.env` file in the `/backend` directory with:

```bash
# ==============================================
# CLARYFY BACKEND ENVIRONMENT CONFIGURATION
# ==============================================

# Server Configuration
NODE_ENV=development
PORT=3000

# OpenAI API Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=1000

# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Weaviate Configuration  
WEAVIATE_URL=https://your-cluster-id.weaviate.network
WEAVIATE_API_KEY=your-weaviate-api-key-here

# Canvas API (existing)
CANVAS_TOKEN=your-canvas-token-here
CANVAS_DOMAIN=umd.instructure.com

# Security & Rate Limiting
JWT_SECRET=your-jwt-secret-here
MAX_REQUESTS_PER_MINUTE=60
MAX_AUDIO_DURATION_MINUTES=60

# Development Settings
DEBUG_MODE=true
LOG_LEVEL=info
```

## Frontend Environment Variables (.env.local)

Create a `.env.local` file in the `/frontend` directory with:

```bash
# ==============================================
# CLARYFY FRONTEND ENVIRONMENT CONFIGURATION
# ==============================================

# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:3000

# Supabase Configuration (Public Keys Only)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# App Configuration
NEXT_PUBLIC_APP_NAME=Claryfy
NEXT_PUBLIC_MAX_RECORDING_MINUTES=60
```

## 🔑 Required API Keys & Accounts

### 1. Supabase Setup
1. Go to [supabase.com](https://supabase.com)
2. Create new project
3. Get Project URL and anon key from Settings > API
4. Get service_role key (keep this secret!)

### 2. OpenAI Setup
1. Go to [platform.openai.com](https://platform.openai.com)
2. Create API key
3. Add billing method (required for API access)

### 3. Weaviate Setup
1. Go to [console.weaviate.cloud](https://console.weaviate.cloud)
2. Create free cluster
3. Get cluster URL and API key

### 4. Canvas Token (you already have this)
- Keep your existing Canvas token and domain

## 📝 Next Steps After Setup

1. Copy the environment variables above
2. Replace placeholder values with your actual API keys
3. Run the dependency installation commands
4. Set up the database schema 