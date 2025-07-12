FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/

WORKDIR /app/backend

# Install dependencies
RUN npm ci --only=production=false

# Copy backend source code
COPY backend/ .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S canvas -u 1001

WORKDIR /app/backend

# Copy backend package files
COPY backend/package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=builder /app/backend/build ./build
COPY --from=builder /app/backend/ ./

# Switch to non-root user
USER canvas

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "import('./build/client.js').then(m => new m.CanvasClient(process.env.CANVAS_API_TOKEN, process.env.CANVAS_DOMAIN).healthCheck()).then(() => process.exit(0)).catch(() => process.exit(1))"

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Command to run the application
CMD ["npm", "run", "start:http"]
