import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Get some configuration values or set default values.
const config = new pulumi.Config();
const instanceType = config.get("instanceType") || "t3.micro";
const vpcNetworkCidr = config.get("vpcNetworkCidr") || "10.0.0.0/16";
const dockerImageUrl = config.require("dockerImageUrl");

// Look up the latest Amazon Linux 2 AMI.
const ami = aws.ec2
	.getAmi({
		filters: [
			{
				name: "name",
				values: ["amzn2-ami-hvm-*"],
			},
		],
		owners: ["amazon"],
		mostRecent: true,
	})
	.then((invoke) => invoke.id);

// User data to install Docker and run your WebSocket server
const userData = pulumi.interpolate`#!/bin/bash
amazon-linux-extras install docker
systemctl start docker
systemctl enable docker
docker pull ${dockerImageUrl}
docker run -d -p 3000:3000 ${dockerImageUrl}
`;

// Create VPC.
const vpc = new aws.ec2.Vpc("vpc", {
	cidrBlock: vpcNetworkCidr,
	enableDnsHostnames: true,
	enableDnsSupport: true,
});

// Create an internet gateway.
const gateway = new aws.ec2.InternetGateway("gateway", { vpcId: vpc.id });

// Create two subnets in different Availability Zones
const subnet1 = new aws.ec2.Subnet("subnet1", {
	vpcId: vpc.id,
	cidrBlock: "10.0.1.0/24",
	availabilityZone: `${aws.config.region}a`,
	mapPublicIpOnLaunch: true,
});

const subnet2 = new aws.ec2.Subnet("subnet2", {
	vpcId: vpc.id,
	cidrBlock: "10.0.2.0/24",
	availabilityZone: `${aws.config.region}b`,
	mapPublicIpOnLaunch: true,
});

// Create a route table.
const routeTable = new aws.ec2.RouteTable("routeTable", {
	vpcId: vpc.id,
	routes: [
		{
			cidrBlock: "0.0.0.0/0",
			gatewayId: gateway.id,
		},
	],
});

// Associate the route table with both public subnets.
const routeTableAssociation1 = new aws.ec2.RouteTableAssociation(
	"routeTableAssociation1",
	{
		subnetId: subnet1.id,
		routeTableId: routeTable.id,
	},
);

const routeTableAssociation2 = new aws.ec2.RouteTableAssociation(
	"routeTableAssociation2",
	{
		subnetId: subnet2.id,
		routeTableId: routeTable.id,
	},
);

// Create a security group for the ALB with rate limiting
const albSecGroup = new aws.ec2.SecurityGroup("albSecGroup", {
	description: "Allow inbound traffic to ALB",
	vpcId: vpc.id,
	ingress: [
		{
			fromPort: 80,
			toPort: 80,
			protocol: "tcp",
			cidrBlocks: ["0.0.0.0/0"],
			description: "Allow HTTP traffic",
		},
	],
	egress: [
		{ fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] },
	],
});

// Create a more restrictive security group for the EC2 instance
const secGroup = new aws.ec2.SecurityGroup("secGroup", {
	description: "Enable access to the Socket.IO server",
	vpcId: vpc.id,
	ingress: [
		{
			fromPort: 3000,
			toPort: 3000,
			protocol: "tcp",
			securityGroups: [albSecGroup.id], // Only allow traffic from ALB
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

// Create and launch an EC2 instance into the public subnet.
const server = new aws.ec2.Instance("server", {
	instanceType: instanceType,
	subnetId: subnet1.id,
	vpcSecurityGroupIds: [secGroup.id],
	userData: userData,
	ami: ami,
	tags: { Name: "websocket-server" },
});

// Create an Application Load Balancer
const alb = new aws.lb.LoadBalancer("websocket-alb", {
	internal: false,
	loadBalancerType: "application",
	securityGroups: [albSecGroup.id],
	subnets: [subnet1.id, subnet2.id],
});

// Create a target group for the ALB
const targetGroup = new aws.lb.TargetGroup("socketio-tg", {
	port: 3000,
	protocol: "HTTP",
	targetType: "instance",
	vpcId: vpc.id,
	healthCheck: {
		enabled: true,
		path: "/health",
		port: "3000",
		protocol: "HTTP",
		healthyThreshold: 2,
		unhealthyThreshold: 10,
		timeout: 5,
		interval: 30,
		matcher: "200-399", // Success codes
	},
	deregistrationDelay: 300, // 5 minutes
	slowStart: 30, // 30 seconds
	stickiness: {
		type: "lb_cookie",
		enabled: true, // Enable stickiness for Socket.IO connections
		cookieDuration: 86400, // 1 day in seconds
	},
});

// Attach the EC2 instance to the target group
const targetGroupAttachment = new aws.lb.TargetGroupAttachment(
	"tg-attachment",
	{
		targetGroupArn: targetGroup.arn,
		targetId: server.id,
		port: 3000,
	},
);

// Create an HTTP listener
const httpListener = new aws.lb.Listener("http-listener", {
	loadBalancerArn: alb.arn,
	port: 80,
	defaultActions: [
		{
			type: "forward",
			targetGroupArn: targetGroup.arn,
		},
	],
});

// Create a WAF WebACL
const wafWebAcl = new aws.wafv2.WebAcl("wafWebAcl", {
	description: "WAF WebACL for WebSocket ALB",
	scope: "REGIONAL",
	defaultAction: { allow: {} },
	rules: [
		{
			name: "rate-limit",
			priority: 1,
			action: { block: {} },
			statement: {
				rateBasedStatement: {
					limit: 2000,
					aggregateKeyType: "IP",
				},
			},
			visibilityConfig: {
				cloudwatchMetricsEnabled: true,
				metricName: "rate-limit-rule",
				sampledRequestsEnabled: true,
			},
		},
	],
	visibilityConfig: {
		cloudwatchMetricsEnabled: true,
		metricName: "waf-web-acl",
		sampledRequestsEnabled: true,
	},
});

// Associate WAF WebACL with ALB
const wafWebAclAssociation = new aws.wafv2.WebAclAssociation(
	"wafWebAclAssociation",
	{
		resourceArn: alb.arn,
		webAclArn: wafWebAcl.arn,
	},
);

// Export the ALB's DNS name and the EC2 instance's public IP
export const albDns = alb.dnsName;
export const instanceIp = server.publicIp;
export const websocketUrl = pulumi.interpolate`http://${alb.dnsName}`;
