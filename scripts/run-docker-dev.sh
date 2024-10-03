#!/bin/bash

# kill port 3000
chmod +x scripts/kill-port-3000.sh
scripts/kill-port-3000.sh

# Load environment variables from .env file
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Use host.docker.internal for local development
REDIS_HOST="host.docker.internal"

# Global variables
CONTAINER_ID=""
CLEANUP_DONE=0

# Function to stop and remove the container
cleanup() {
    if [ $CLEANUP_DONE -eq 1 ]; then
        return
    fi
    CLEANUP_DONE=1
    
    echo -e "\nStopping and removing the container..."
    if [ ! -z "$CONTAINER_ID" ]; then
        docker stop $CONTAINER_ID 2>/dev/null || true
        docker rm $CONTAINER_ID 2>/dev/null || true
    fi
}

# Set up trap to call cleanup function on script exit or interrupt
trap cleanup EXIT SIGINT SIGTERM

# Run Docker with environment variables
docker run --rm -d -p 3000:3000 \
  -e NODE_ENV=development \
  -e UPSTASH_REDIS_URL=$UPSTASH_REDIS_URL \
  -e UPSTASH_REDIS_TOKEN=$UPSTASH_REDIS_TOKEN \
  --add-host=host.docker.internal:host-gateway \
  -v $(pwd)/src:/usr/src/app/src \
  gate-cs-ws > /tmp/container_id

CONTAINER_ID=$(cat /tmp/container_id)
rm /tmp/container_id

echo "Container started with ID: $CONTAINER_ID"

# Follow the logs
docker logs -f $CONTAINER_ID &

# Wait for the container to exit or for a signal
wait $!

# Cleanup will be called automatically by the trap