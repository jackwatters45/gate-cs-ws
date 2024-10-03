import { Redis } from "@upstash/redis";
import http from "node:http";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import winston from "winston";
import type { DefaultEventsMap } from "socket.io/dist/typed-events";

// Define the structure of whiteboard data
interface WhiteboardData {
	content: string;
	lastUpdated: number;
}

// Extend the Socket type to include whiteboardId
interface WhiteboardSocket
	// biome-ignore lint/suspicious/noExplicitAny: <doesn't matter>
	extends Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any> {
	whiteboardId?: string;
}

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

const isDev = process.env.NODE_ENV === "development";

const httpServer = http.createServer((req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("OK");
	} else {
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not Found");
	}
});

// Redis configuration
const redisUrl = process.env.UPSTASH_REDIS_URL;
const redisToken = process.env.UPSTASH_REDIS_TOKEN;

if (!redisUrl || !redisToken) {
	logger.error("Redis URL or token not provided");
	process.exit(1);
}

// Create Redis client
const redis = new Redis({
	url: redisUrl,
	token: redisToken,
});

const io = new Server(httpServer, {
	cors: {
		origin: [
			"https://gate-cs.jackwatters.dev",
			"https://gate-cs-ws.jackwatters.dev",
			isDev && "http://localhost:4321",
			isDev && "http://localhost:3000",
		].filter(Boolean),
		methods: ["GET", "POST"],
	},
});

io.on("connection", (socket: WhiteboardSocket) => {
	logger.info("A user connected");

	socket.on("joinWhiteboard", async (whiteboardId: string) => {
		logger.info(`User joined whiteboard: ${whiteboardId}`);

		if (socket.whiteboardId) {
			socket.leave(socket.whiteboardId);
		}

		socket.join(whiteboardId);
		socket.whiteboardId = whiteboardId;

		try {
			let whiteboardData = await redis.get<WhiteboardData>(
				`whiteboard:${whiteboardId}`,
			);
			if (!whiteboardData) {
				whiteboardData = { content: "", lastUpdated: Date.now() };
				await redis.set(
					`whiteboard:${whiteboardId}`,
					JSON.stringify(whiteboardData),
				);
			}

			socket.emit("whiteboardData", whiteboardData);
		} catch (error) {
			logger.error("Error fetching whiteboard data:", error);
			socket.emit("error", "Failed to fetch whiteboard data");
		}
	});

	socket.on("updateWhiteboard", async (data: WhiteboardData) => {
		if (socket.whiteboardId) {
			try {
				data.lastUpdated = Date.now();
				await redis.set(`whiteboard:${socket.whiteboardId}`, JSON.stringify(data));

				socket.to(socket.whiteboardId).emit("whiteboardUpdate", data);
			} catch (error) {
				logger.error("Error updating whiteboard data:", error);
				socket.emit("error", "Failed to update whiteboard data");
			}
		}
	});

	socket.on("disconnect", () => {
		logger.info("User disconnected");
		if (socket.whiteboardId) {
			socket.leave(socket.whiteboardId);
		}
	});
});

httpServer.on("error", (error) => {
	logger.error("HTTP server error:", error);
});

io.on("connect_error", (error) => {
	logger.error("Socket.IO connection error:", error);
});

const PORT = process.env.SOCKET_PORT ?? 3000;
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
