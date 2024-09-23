# Use an official Node runtime as the base image
FROM node:18-alpine

# Install pnpm
RUN npm install -g pnpm

# Set the working directory in the container
WORKDIR /usr/src

# Copy package.json (and pnpm-lock.yaml if it exists)
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install dependencies
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
    else echo "Warning: pnpm-lock.yaml not found. Running pnpm install." && pnpm install; \
    fi

# Copy the server source code
COPY src ./src

# Copy TypeScript config
COPY tsconfig.json ./

# Build the TypeScript code
RUN pnpm run build

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "dist/server.js"]

