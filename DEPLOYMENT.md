# Canvas LMS Deployment Guide

## Overview
This guide will help you deploy the Canvas LMS application to:
- **Frontend**: Vercel (Next.js)
- **Backend**: Heroku (Express.js)

## Prerequisites
- GitHub account
- Vercel account (free)
- Heroku account (free tier available)
- Canvas API token

## Step 1: GitHub Setup

### Create Frontend Repository
```bash
cd frontend
rm -rf .git
git init
git add .
git commit -m "Initial commit: Canvas LMS Frontend"
```

### Create Backend Repository
```bash
cd ../backend
rm -rf .git
git init
git add .
git commit -m "Initial commit: Canvas LMS Backend"
```

## Step 2: Deploy Backend to Heroku

### Create Heroku App
1. Go to [Heroku Dashboard](https://dashboard.heroku.com/)
2. Click "New" → "Create new app"
3. Choose app name (e.g., `canvas-lms-backend`)
4. Select region
5. Click "Create app"

### Connect to GitHub
1. In your Heroku app dashboard, go to "Deploy" tab
2. Choose "GitHub" as deployment method
3. Connect your GitHub account
4. Select your backend repository
5. Enable automatic deploys from `main` branch

### Set Environment Variables
In Heroku dashboard → Settings → Config Vars:
```
NODE_ENV=production
```

### Deploy
1. Click "Deploy Branch" in Heroku dashboard
2. Wait for build to complete
3. Note your Heroku URL: `https://your-app-name.herokuapp.com`

## Step 3: Deploy Frontend to Vercel

### Create Vercel Project
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your frontend GitHub repository
4. Configure project:
   - Framework Preset: Next.js
   - Root Directory: `./` (default)
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)

### Set Environment Variables
In Vercel project settings → Environment Variables:
```
NEXT_PUBLIC_API_URL=https://your-app-name.herokuapp.com
```
(Replace with your actual Heroku URL)

### Deploy
1. Click "Deploy"
2. Wait for build to complete
3. Your app will be available at: `https://your-project.vercel.app`

## Step 4: Test Deployment

### Test Backend
1. Visit your Heroku URL: `https://your-app-name.herokuapp.com`
2. You should see a simple page or API response

### Test Frontend
1. Visit your Vercel URL: `https://your-project.vercel.app`
2. Enter your Canvas API token and domain
3. Test file viewing functionality

## Environment Variables Summary

### Backend (Heroku)
```
NODE_ENV=production
```

### Frontend (Vercel)
```
NEXT_PUBLIC_API_URL=https://your-app-name.herokuapp.com
```

## Troubleshooting

### Backend Issues
- Check Heroku logs: `heroku logs --tail`
- Ensure `npm start` works locally
- Verify all dependencies are in `package.json`

### Frontend Issues
- Check Vercel build logs
- Verify environment variables are set correctly
- Test API calls to backend URL

### Canvas API Issues
- Verify your Canvas API token is valid
- Check Canvas domain is correct
- Ensure token has necessary permissions

## Next Steps
- Add custom domain (optional)
- Set up monitoring and logging
- Implement user authentication system
- Add database for multi-user support 