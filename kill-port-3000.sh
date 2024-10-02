#!/bin/bash

# Find the PID of the process using port 3000
PID=$(lsof -ti:3000)

if [ -z "$PID" ]; then
    echo "No process found using port 3000"
    exit 0
else
    echo "Found process $PID using port 3000"
    echo "Attempting to kill process..."
    kill -15 $PID
    sleep 2
    
    # Check if the process is still running
    if ps -p $PID > /dev/null; then
        echo "Process did not terminate gracefully. Forcing termination..."
        kill -9 $PID
        sleep 1
    fi
    
    # Final check
    if ps -p $PID > /dev/null; then
        echo "Failed to kill process $PID"
        exit 1
    else
        echo "Successfully terminated process $PID"
        exit 0
    fi
fi