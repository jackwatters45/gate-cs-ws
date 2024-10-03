#!/bin/bash

# Find the container ID using port 3000
CONTAINER_ID=$(docker ps -q --filter "publish=3000")

if [ -z "$CONTAINER_ID" ]; then
    echo "No Docker container found using port 3000"
    exit 0
else
    echo "Found Docker container $CONTAINER_ID using port 3000"
    echo "Forcefully removing the container..."
    
    # Forcefully remove the container
    if docker rm -f $CONTAINER_ID > /dev/null 2>&1; then
        echo "Successfully removed container $CONTAINER_ID"
        exit 0
    else
        echo "Failed to remove container $CONTAINER_ID"
        exit 1
    fi
fi