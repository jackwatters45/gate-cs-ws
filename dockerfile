# Use an official Node runtime as the base image
FROM node:18-alpine

# Install pnpm
RUN npm install -g pnpm

# Create app directory and set permissions
RUN mkdir -p /usr/src && chown -R node:node /usr/src

# Set the working directory in the container
WORKDIR /usr/src

# Switch to non-root user
USER node

# Copy package.json and pnpm-lock.yaml
COPY --chown=node:node package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the server source code and TypeScript config
COPY --chown=node:node src ./src
COPY --chown=node:node tsconfig.json ./

# Build the TypeScript code
RUN pnpm run build

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "dist/server.js"]