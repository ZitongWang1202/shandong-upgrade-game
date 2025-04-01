import { io } from "socket.io-client";

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001';

const socket = io(SOCKET_URL, {
  reconnectionDelay: 1000,
  reconnection: true,
  reconnectionAttempts: 10,
  transports: ['websocket'],
  agent: false,
  upgrade: false,
  rejectUnauthorized: false
});

socket.on('connect_error', (error) => {
  console.log('Connection Error:', error);
});

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

export default socket;