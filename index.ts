import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as cloudinit from "@pulumi/cloudinit";

// Get some configuration values or set default values.
const config = new pulumi.Config();
const instanceType = config.get("instanceType") || "t4g.micro";
const vpcNetworkCidr = config.get("vpcNetworkCidr") || "10.0.0.0/16";
const dockerImageUrl = config.require("dockerImageUrl");
const sshAccessIp = config.get("sshAccessIp") ?? "0.0.0.0/0";

// Look up the latest Amazon Linux 2023 AMI.
const ami = aws.ec2.getAmiOutput({
	filters: [
		{ name: "name", values: ["al2023-ami-*-arm64"] },
		{ name: "virtualization-type", values: ["hvm"] },
	],
	owners: ["amazon"],
	mostRecent: true,
});

// Create SSM Parameters for Redis URL and Token
const redisUrlParam = new aws.ssm.Parameter("redisUrlParam", {
	type: "SecureString",
	name: "/gate-cs-ws/UPSTASH_REDIS_URL",
	value: config.requireSecret("redisUrl"),
});

const redisTokenParam = new aws.ssm.Parameter("redisTokenParam", {
	type: "SecureString",
	name: "/gate-cs-ws/UPSTASH_REDIS_TOKEN",
	value: config.requireSecret("redisToken"),
});

// Create an IAM role for the EC2 instance
const role = new aws.iam.Role("webSocketServerRole", {
	assumeRolePolicy: JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Action: "sts:AssumeRole",
				Effect: "Allow",
				Principal: {
					Service: "ec2.amazonaws.com",
				},
			},
		],
	}),
});

// Attach the AmazonEC2ContainerRegistryReadOnly policy to the role
new aws.iam.RolePolicyAttachment("ecrPolicyAttachment", {
	policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
	role: role.name,
});

// Add CloudWatch Agent policy attachment
new aws.iam.RolePolicyAttachment("cloudwatchAgentPolicyAttachment", {
	policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
	role: role.name,
});

// Add policy for SSM Parameter access
new aws.iam.RolePolicy("ssmParamPolicy", {
	role: role.id,
	policy: {
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: [
					"ssm:GetParameter",
					"ssm:GetParameters",
					"ssm:GetParametersByPath",
				],
				Resource: [redisUrlParam.arn, redisTokenParam.arn],
			},
		],
	},
});

// Create an instance profile
const webSocketServerInstanceProfile = new aws.iam.InstanceProfile(
	"webSocketServerInstanceProfile",
	{
		role: role.name,
	},
);

const logGroup = new aws.cloudwatch.LogGroup("websocket-server-logs", {
	name: "/websocket-server/logs",
	retentionInDays: 7,
});

const cloudWatchConfig = {
	agent: {
		run_as_user: "root",
	},
	logs: {
		logs_collected: {
			files: {
				collect_list: [
					{
						file_path: "/usr/src/combined.log",
						log_group_name: logGroup.name,
						log_stream_name: "websocket-server-logs",
					},
				],
			},
		},
	},
};

const cloudInitConfig = cloudinit.getConfig({
	gzip: false,
	base64Encode: false,
	parts: [
		{
			content: `#cloud-config
packages:
- amazon-cloudwatch-agent
write_files:
- path: /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
	content: '${JSON.stringify(cloudWatchConfig)}'
	permissions: '0644'
runcmd:
- amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
- systemctl enable amazon-cloudwatch-agent
- systemctl start amazon-cloudwatch-agent
`,
			contentType: "text/cloud-config",
		},
	],
});

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
		{
			fromPort: 443,
			toPort: 443,
			protocol: "tcp",
			cidrBlocks: ["0.0.0.0/0"],
			description: "Allow HTTPS traffic",
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
		{
			fromPort: 22,
			toPort: 22,
			protocol: "tcp",
			cidrBlocks: [sshAccessIp],
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

// Create an Application Load Balancer
const alb = new aws.lb.LoadBalancer("websocket-alb", {
	internal: false,
	loadBalancerType: "application",
	securityGroups: [albSecGroup.id],
	subnets: [subnet1.id, subnet2.id],
	idleTimeout: 3600,
});

// Update the user data to include Redis configuration
const userData = pulumi.interpolate`#!/bin/bash
set -e  # Exit immediately if a command exits with a non-zero status
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

echo "Starting user data script..."

# Update and install packages
dnf update -y
dnf install -y docker aws-cli amazon-cloudwatch-agent

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Add ec2-user to docker group
usermod -aG docker ec2-user

# Adjust Docker socket permissions (consider a more secure approach in production)
chmod 666 /var/run/docker.sock

echo "Docker installed and configured"

# Configure CloudWatch agent
cat <<EOF > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
${JSON.stringify(cloudWatchConfig)}
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
systemctl enable amazon-cloudwatch-agent
systemctl start amazon-cloudwatch-agent

echo "CloudWatch agent configured and started"

# Fetch Redis credentials from SSM
REDIS_URL=$(aws ssm get-parameter --name /gate-cs-ws/UPSTASH_REDIS_URL --with-decryption --query Parameter.Value --output text --region ${aws.config.region})
REDIS_TOKEN=$(aws ssm get-parameter --name /gate-cs-ws/UPSTASH_REDIS_TOKEN --with-decryption --query Parameter.Value --output text --region ${aws.config.region})

if [ -z "$REDIS_URL" ] || [ -z "$REDIS_TOKEN" ]; then
    echo "Error: Failed to retrieve Redis credentials from SSM"
    exit 1
fi

# Create a .env file for the application
mkdir -p /app
echo "UPSTASH_REDIS_URL=$REDIS_URL" > /app/.env
echo "UPSTASH_REDIS_TOKEN=$REDIS_TOKEN" >> /app/.env
chmod 600 /app/.env

# Login to ECR
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 533267298476.dkr.ecr.us-west-2.amazonaws.com
echo "Logged in to ECR"

# Pull the Docker image
docker pull ${dockerImageUrl}
echo "Docker image pulled"

# Run the Docker container with environment variables
docker run -d --restart unless-stopped -p 3000:3000 \
    -e NODE_ENV=production \
    -e ALB_DNS=${alb.dnsName} \
    -e UPSTASH_REDIS_URL="$REDIS_URL" \
    -e UPSTASH_REDIS_TOKEN="$REDIS_TOKEN" \
    ${dockerImageUrl}

echo "Docker container started with Redis configuration"

# Verify the container is running
docker ps

echo "User data script completed successfully"
`;

// Create and launch an EC2 instance into the public subnet.
const server = new aws.ec2.Instance("server", {
	instanceType: instanceType,
	subnetId: subnet1.id,
	vpcSecurityGroupIds: [secGroup.id],
	userData: userData,
	ami: ami.id,
	keyName: "my-websocket-keypair",
	iamInstanceProfile: webSocketServerInstanceProfile.name,
	tags: { Name: "websocket-server" },
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

// HTTP listener for redirecting HTTP to HTTPS
const httpListener = new aws.lb.Listener("http-listener", {
	loadBalancerArn: alb.arn,
	port: 80,
	defaultActions: [
		{
			type: "redirect",
			redirect: {
				port: "443",
				protocol: "HTTPS",
				statusCode: "HTTP_301",
			},
		},
	],
});

// Request a certificate from ACM
const cert = new aws.acm.Certificate("cert", {
	domainName: "gate-cs-ws.jackwatters.dev",
	validationMethod: "DNS",
	subjectAlternativeNames: ["*.gate-cs-ws.jackwatters.dev"], // Include wildcard for subdomains
});

// Export the certificate validation details
export const certificateValidationDetails = cert.domainValidationOptions[0];

if (!certificateValidationDetails) {
	throw new Error("Certificate validation details not found");
}

// Wait for the certificate to be validated
const certValidation = new aws.acm.CertificateValidation("certValidation", {
	certificateArn: cert.arn,
	validationRecordFqdns: [
		pulumi.interpolate`${certificateValidationDetails.resourceRecordName}`,
	],
});

// Create a HTTPS listener
const httpsListener = new aws.lb.Listener("https-listener", {
	loadBalancerArn: alb.arn,
	port: 443,
	protocol: "HTTPS",
	sslPolicy: "ELBSecurityPolicy-2016-08",
	certificateArn: certValidation.certificateArn,
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
export const websocketUrl = pulumi.interpolate`https://${alb.dnsName}`;
