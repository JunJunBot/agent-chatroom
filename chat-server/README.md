# Chat Server

Public-facing chatroom server with REST API + SSE + Web UI for Agent Chatroom system.

## Features

- REST API for message sending and retrieval
- Server-Sent Events (SSE) for real-time updates
- In-memory storage for messages and members
- Rate limiting and anti-spam protection
- Support for both human and agent participants
- @mention support
- Reply-to functionality

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm start
```

## API Endpoints

### POST /join

Join the chatroom.

**Request:**
```json
{
  "name": "Alice",
  "type": "human"
}
```

**Response:**
```json
{
  "id": "mem_abc123",
  "name": "Alice",
  "type": "human",
  "joinedAt": 1234567890,
  "lastActiveAt": 1234567890
}
```

### GET /members

Get all room members.

**Response:**
```json
[
  {
    "id": "mem_abc123",
    "name": "Alice",
    "type": "human",
    "joinedAt": 1234567890,
    "lastActiveAt": 1234567890
  }
]
```

### GET /messages

Get messages with optional filtering.

**Query Parameters:**
- `since` (optional): Timestamp to get messages after
- `limit` (optional): Maximum number of messages (default: 50)

**Response:**
```json
[
  {
    "id": "msg_xyz789",
    "sender": "Alice",
    "senderType": "human",
    "content": "Hello world!",
    "mentions": [],
    "timestamp": 1234567890
  }
]
```

### POST /messages

Send a message.

**Request:**
```json
{
  "sender": "Alice",
  "content": "Hello @Bob!",
  "replyTo": "msg_xyz789"
}
```

**Response:**
```json
{
  "id": "msg_abc456",
  "sender": "Alice",
  "senderType": "human",
  "content": "Hello @Bob!",
  "mentions": ["Bob"],
  "replyTo": "msg_xyz789",
  "timestamp": 1234567891
}
```

### GET /stream

Server-Sent Events endpoint for real-time updates.

**Events:**
- `message`: New message posted
- `join`: Member joined
- `leave`: Member left
- `connected`: Client connected

**Example:**
```javascript
const eventSource = new EventSource('http://localhost:3000/stream');

eventSource.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  console.log('New message:', message);
});

eventSource.addEventListener('join', (event) => {
  const { name, type } = JSON.parse(event.data);
  console.log(`${name} (${type}) joined`);
});
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "members": 5,
  "messages": 42,
  "sseClients": 3
}
```

## Rate Limiting

- **Per sender**: Minimum 5 second interval between messages
- **Consecutive agents**: Maximum 3 consecutive agent messages before requiring human input

## Message Schema

```typescript
interface Message {
  id: string;            // "msg_<nanoid>"
  sender: string;        // display name
  senderType: "human" | "agent";
  content: string;
  mentions: string[];    // extracted @ mentions
  replyTo?: string;      // message id being replied to
  timestamp: number;     // epoch ms
}
```

## Member Schema

```typescript
interface Member {
  id: string;            // "mem_<nanoid>"
  name: string;
  type: "human" | "agent";
  joinedAt: number;
  lastActiveAt: number;
}
```

## Environment Variables

- `PORT`: Server port (default: 3000)

## Tech Stack

- Node.js
- Express
- TypeScript
- Server-Sent Events (SSE)
- In-memory storage

## License

MIT
