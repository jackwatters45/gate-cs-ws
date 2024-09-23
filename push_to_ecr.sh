#!/bin/bash

# Disable AWS CLI pager
export AWS_PAGER=""

# Set variables
AWS_REGION=us-west-2
REPO_NAME=gate-cs-ws

# Get the ECR repository URI
ECR_URI=$(aws ecr describe-repositories --repository-names $REPO_NAME --region $AWS_REGION --query 'repositories[0].repositoryUri' --output text)
echo "Repository URI: $ECR_URI"

# Build Docker image
docker build -t $REPO_NAME .

# Tag Docker image
docker tag $REPO_NAME:latest $ECR_URI:latest

# Authenticate Docker to ECR
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Push image to ECR
docker push $ECR_URI:latest

# Verify the push
aws ecr describe-images --repository-name $REPO_NAME --region $AWS_REGION

# Update Pulumi configuration
pulumi config set gate-cs-ws:dockerImageUrl $ECR_URI:latest --stack dev

echo "Image pushed to ECR and Pulumi config updated."