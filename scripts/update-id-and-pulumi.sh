#!/bin/bash

# Get the current public IP address
CURRENT_IP=$(curl -s https://api.ipify.org)

# Update the Pulumi configuration
pulumi config set gate-cs-ws:sshAccessIp "${CURRENT_IP}/32" --stack dev

# Run Pulumi up to apply the changes
pulumi up --yes