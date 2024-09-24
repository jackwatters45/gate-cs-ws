# gate-cs-ws

Websockets server for gate-cs class website. Deployed to AWS using Pulumi.
  
  ---
  // Create a more restrictive security group for the EC2 instance
const secGroup = new aws.ec2.SecurityGroup("websocket-secgroup", {
  description: "Security group for WebSocket server",
  vpcId: vpc.id,
  ingress: [
    {
      fromPort: 3000,
      toPort: 3000,
      protocol: "tcp",
      cidrBlocks: ["0.0.0.0/0"], // Consider restricting this to specific IP ranges if possible
    },
  ],
  egress: [
    {
      fromPort: 0,
      toPort: 0,
      protocol: "-1",
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

// Update your EC2 instance to use this security group
const server = new aws.ec2.Instance("websocket-server", {
  // ... other configurations
  vpcSecurityGroupIds: [secGroup.id],
  // ...
});