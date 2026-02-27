#!/bin/bash

# Test script for chat-server API
BASE_URL="http://localhost:3000"

echo "Testing Chat Server API"
echo "======================="
echo ""

# Test health endpoint
echo "1. Testing /health endpoint..."
curl -s "$BASE_URL/health" | jq '.' || echo "Please start the server first with: npm run dev"
echo ""

# Test join
echo "2. Testing /join endpoint..."
curl -s -X POST "$BASE_URL/join" \
  -H "Content-Type: application/json" \
  -d '{"name": "TestUser", "type": "human"}' | jq '.'
echo ""

# Test members
echo "3. Testing /members endpoint..."
curl -s "$BASE_URL/members" | jq '.'
echo ""

# Test send message
echo "4. Testing /messages POST endpoint..."
curl -s -X POST "$BASE_URL/messages" \
  -H "Content-Type: application/json" \
  -d '{"sender": "TestUser", "content": "Hello world!"}' | jq '.'
echo ""

# Test get messages
echo "5. Testing /messages GET endpoint..."
curl -s "$BASE_URL/messages" | jq '.'
echo ""

echo "Test complete!"
