const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, "public")));

// In-memory store
const users = {}; // socket.id -> { username, room, avatar }
const rooms = {
  general: { name: "# general", messages: [] },
  random: { name: "# random", messages: [] },
  tech: { name: "# tech", messages: [] },
};

// Helper: get users in a room
function getUsersInRoom(room) {
  return Object.values(users).filter((u) => u.room === room);
}

// Helper: save message to room history (last 50)
function saveMessage(room, msg) {
  if (!rooms[room]) return;
  rooms[room].messages.push(msg);
  if (rooms[room].messages.length > 50) rooms[room].messages.shift();
}

io.on("connection", (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // --- JOIN ---
  socket.on("join", ({ username, room }) => {
    if (!username || !room) return;

    // Leave previous room if any
    const prev = users[socket.id];
    if (prev) {
      socket.leave(prev.room);
      io.to(prev.room).emit("system_message", {
        text: `${prev.username} left the room.`,
        timestamp: Date.now(),
      });
      io.to(prev.room).emit("room_users", getUsersInRoom(prev.room));
    }

    // Assign a random avatar color
    const colors = [
      "#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7",
      "#DDA0DD","#98FB98","#F0E68C","#87CEEB","#FFB6C1",
    ];
    const avatar = colors[Math.floor(Math.random() * colors.length)];

    users[socket.id] = { username, room, avatar, id: socket.id };
    socket.join(room);

    // Send room history to the joining user
    socket.emit("room_history", {
      room,
      messages: rooms[room]?.messages || [],
    });

    // Notify room
    const joinMsg = {
      text: `${username} joined the room!`,
      timestamp: Date.now(),
    };
    io.to(room).emit("system_message", joinMsg);

    // Send updated user list to room
    io.to(room).emit("room_users", getUsersInRoom(room));

    // Send available rooms to everyone
    socket.emit("rooms_list", Object.keys(rooms));

    console.log(`[JOIN] ${username} -> #${room}`);
  });

  // --- CHAT MESSAGE ---
  socket.on("chat_message", ({ text, room }) => {
    const user = users[socket.id];
    if (!user || !text?.trim()) return;

    const msg = {
      id: `${Date.now()}-${socket.id}`,
      username: user.username,
      avatar: user.avatar,
      text: text.trim(),
      timestamp: Date.now(),
      room,
    };

    saveMessage(room, msg);
    io.to(room).emit("chat_message", msg);
    console.log(`[MSG] ${user.username} in #${room}: ${text.trim()}`);
  });

  // --- TYPING INDICATOR ---
  socket.on("typing", ({ room, isTyping }) => {
    const user = users[socket.id];
    if (!user) return;
    socket.to(room).emit("typing", {
      username: user.username,
      isTyping,
    });
  });

  // --- SWITCH ROOM ---
  socket.on("switch_room", ({ room }) => {
    const user = users[socket.id];
    if (!user || !rooms[room]) return;

    // Leave old room
    socket.leave(user.room);
    io.to(user.room).emit("system_message", {
      text: `${user.username} left the room.`,
      timestamp: Date.now(),
    });
    io.to(user.room).emit("room_users", getUsersInRoom(user.room));

    // Join new room
    const oldRoom = user.room;
    user.room = room;
    socket.join(room);

    socket.emit("room_history", {
      room,
      messages: rooms[room]?.messages || [],
    });

    io.to(room).emit("system_message", {
      text: `${user.username} joined the room!`,
      timestamp: Date.now(),
    });
    io.to(room).emit("room_users", getUsersInRoom(room));

    console.log(`[SWITCH] ${user.username}: #${oldRoom} -> #${room}`);
  });

  // --- DISCONNECT ---
  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (user) {
      io.to(user.room).emit("system_message", {
        text: `${user.username} disconnected.`,
        timestamp: Date.now(),
      });
      io.to(user.room).emit("room_users", getUsersInRoom(user.room));
      delete users[socket.id];
      console.log(`[-] ${user.username} disconnected`);
    }
  });
});

// Health check endpoint
app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    connections: Object.keys(users).length,
    rooms: Object.keys(rooms).map((r) => ({
      id: r,
      name: rooms[r].name,
      users: getUsersInRoom(r).length,
    })),
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Chat server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO ready for connections\n`);
});
