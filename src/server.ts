import http from "node:http";
import { Server } from "socket.io";

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
			process.env.NODE_ENV === "development" && "http://localhost:4321",
			"http://localhost:4321",
		].filter(Boolean),
		methods: ["GET", "POST"],
	},
});

let sharedCode = "// Start coding here\n";

io.on("connection", (socket) => {
	console.log("A user connected");

	// Send current code to newly connected client
	socket.emit("initialCode", sharedCode);

	// Handle code updates
	socket.on("codeChange", (newCode) => {
		sharedCode = newCode;
		// Broadcast to all clients except sender
		socket.broadcast.emit("codeUpdate", newCode);
	});

	socket.on("disconnect", () => {
		console.log("User disconnected");
	});
});

const PORT = process.env.SOCKET_PORT || 3000;
httpServer.listen(PORT, () => {
	console.log(`Socket.IO server running on port ${PORT}`);
});
