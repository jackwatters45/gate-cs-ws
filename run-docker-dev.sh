#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Use host.docker.internal for local development
REDIS_HOST="host.docker.internal"

# Run Docker with environment variables
docker run -p 3000:3000 \
  -e NODE_ENV=development \
  -e REDIS_ENDPOINT=$REDIS_HOST \
  -e REDIS_PORT=$REDIS_PORT \
  --add-host=host.docker.internal:host-gateway \
  -v $(pwd)/src:/usr/src/app/src \
  gate-cs-ws