import http from "node:http";
import { Server } from "socket.io";
import winston from "winston";

const logger = winston.createLogger({
	level: "info",
	format: winston.format.json(),
	defaultMeta: { service: "websocket-server" },
	transports: [
		new winston.transports.Console(),
		new winston.transports.File({ filename: "error.log", level: "error" }),
		new winston.transports.File({ filename: "combined.log" }),
	],
});

const albDns = process.env.ALB_DNS;
const isDev = process.env.NODE_ENV === "development";

if (!albDns && !isDev) {
	throw new Error("ALB_DNS environment variable not set");
}

const httpServer = http.createServer((req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("OK");
	} else {
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not Found");
	}
});

const io = new Server(httpServer, {
	cors: {
		origin: [
			"https://gate-cs.jackwatters.dev",
			isDev ? "http://localhost:4321" : `http://${albDns}`,
		].filter(Boolean),
		methods: ["GET", "POST"],
	},
});

let sharedCode = "// Start coding here\n";

io.on("connection", (socket) => {
	logger.info("A user connected");

	// Send current code to newly connected client
	socket.emit("initialCode", sharedCode);

	// Handle code updates
	socket.on("codeChange", (newCode) => {
		sharedCode = newCode;
		// Broadcast to all clients except sender
		socket.broadcast.emit("codeUpdate", newCode);
	});

	socket.on("disconnect", () => {
		logger.info("User disconnected");
	});
});

httpServer.on("error", (error) => {
	logger.error("HTTP server error:", error);
});

io.on("connect_error", (error) => {
	logger.error("Socket.IO connection error:", error);
});

const PORT = process.env.SOCKET_PORT || 3000;
httpServer.listen(PORT, () => {
	logger.info(`Socket.IO server running on port ${PORT}`);
});

process.on("uncaughtException", (error) => {
	logger.error("Uncaught Exception:", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	logger.error("Unhandled Rejection at:", promise, "reason:", reason);
	process.exit(1);
});
