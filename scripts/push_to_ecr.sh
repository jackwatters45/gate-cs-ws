#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Load environment variables from .env file
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Disable AWS CLI pager
export AWS_PAGER=""

# Set variables
AWS_REGION=us-west-2
REPO_NAME=gate-cs-ws

# Ensure required environment variables are set
if [ -z "$AWS_REGION" ]; then
    echo "Error: AWS_REGION must be set"
    exit 1
fi

# Function to check if already logged in to ECR
check_ecr_login() {
    # Attempt to get an authentication token
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI >/dev/null 2>&1
}

# Function to authenticate with ECR
ecr_login() {
    echo "Authenticating with ECR..."
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI
}

# Get the ECR repository URI
ECR_URI=$(aws ecr describe-repositories --repository-names $REPO_NAME --region $AWS_REGION --query 'repositories[0].repositoryUri' --output text)
if [ -z "$ECR_URI" ]; then
    echo "Error: Failed to get ECR repository URI"
    exit 1
fi
echo "Repository URI: $ECR_URI"

# Check if already logged in, if not, then login
if check_ecr_login; then
    echo "Already logged in to ECR"
else
    ecr_login
fi

# Build Docker image
echo "Building Docker image..."
docker build -t $REPO_NAME .

# Tag Docker image
echo "Tagging Docker image..."
docker tag $REPO_NAME:latest $ECR_URI:latest

# Push image to ECR
echo "Pushing image to ECR..."
push_image() {
    docker push $ECR_URI:latest
}

# Try to push the image, re-authenticate if token has expired
push_image || {
    echo "Push failed, attempting to re-authenticate..."
    ecr_login
    push_image
}

# Verify the push
echo "Verifying the push..."
aws ecr describe-images --repository-name $REPO_NAME --region $AWS_REGION

# Update Pulumi configuration
echo "Updating Pulumi configuration..."
pulumi config set gate-cs-ws:dockerImageUrl $ECR_URI:latest --stack dev

echo "Image pushed to ECR and Pulumi config updated successfully."
