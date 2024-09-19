import http from "node:http";
import { Server } from "socket.io";

const httpServer = http.createServer();
const io = new Server(httpServer, {
	cors: {
		origin: "http://localhost:4321", // TODO: Change this to the actual URL of application
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
