#!/bin/bash

# Ensure required environment variables are set
if [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$AWS_REGION" ]; then
    echo "Error: AWS_ACCOUNT_ID and AWS_REGION must be set"
    exit 1
fi

# Perform ECR login
aws ecr get-login-password --region $AWS_REGION | \
docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

echo "ECR login completed"