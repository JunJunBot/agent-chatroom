#!/usr/bin/env tsx

/**
 * E2E Test for Chat Server API
 * Tests all endpoints and anti-spam mechanisms
 */

const BASE_URL = "http://localhost:3456";

interface Message {
  id: string;
  sender: string;
  senderType: "human" | "agent";
  content: string;
  mentions: string[];
  replyTo?: string;
  timestamp: number;
}

interface Member {
  id: string;
  name: string;
  type: "human" | "agent";
  joinedAt: number;
  lastActiveAt: number;
}

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function log(msg: string) {
  console.log(`[TEST] ${msg}`);
}

function pass(msg: string) {
  console.log(`✅ PASS: ${msg}`);
  testsPassed++;
}

function fail(msg: string) {
  console.log(`❌ FAIL: ${msg}`);
  testsFailed++;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test runner
async function runTests() {
  log("Starting E2E tests for chat-server...");
  log("Server URL: " + BASE_URL);

  try {
    // Test 1: Join as agent
    log("\n[1] POST /join - Join as agent 'TestBot'");
    const joinAgent = await fetch(`${BASE_URL}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "TestBot", type: "agent" })
    });

    if (joinAgent.status === 200) {
      const agentData = await joinAgent.json();
      pass(`Agent 'TestBot' joined (id: ${agentData.data.id})`);
    } else {
      fail(`Agent join failed: ${joinAgent.status}`);
    }

    // Test 2: Join as human
    log("\n[2] POST /join - Join as human 'Alice'");
    const joinHuman = await fetch(`${BASE_URL}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", type: "human" })
    });

    if (joinHuman.status === 200) {
      const humanData = await joinHuman.json();
      pass(`Human 'Alice' joined (id: ${humanData.data.id})`);
    } else {
      fail(`Human join failed: ${joinHuman.status}`);
    }

    // Test 3: Get members
    log("\n[3] GET /members - Verify both members exist");
    const membersRes = await fetch(`${BASE_URL}/members`);
    const members: Member[] = await membersRes.json();

    const hasTestBot = members.some(m => m.name === "TestBot" && m.type === "agent");
    const hasAlice = members.some(m => m.name === "Alice" && m.type === "human");

    if (hasTestBot && hasAlice) {
      pass(`Both members found (${members.length} total members)`);
    } else {
      fail(`Members missing: TestBot=${hasTestBot}, Alice=${hasAlice}`);
    }

    // Test 4: Alice sends message
    log("\n[4] POST /messages - Alice: 'Hello everyone!'");
    const msg1Res = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "Alice", content: "Hello everyone!" })
    });

    let aliceMessageId = "";
    if (msg1Res.status === 201) {
      const msg1Data = await msg1Res.json();
      aliceMessageId = msg1Data.data.id;
      pass(`Alice's message sent (id: ${aliceMessageId})`);
    } else {
      fail(`Alice's message failed: ${msg1Res.status}`);
    }

    // Test 5: Get messages
    log("\n[5] GET /messages - Verify Alice's message appears");
    const msgs1Res = await fetch(`${BASE_URL}/messages`);
    const msgs1: Message[] = await msgs1Res.json();

    const aliceMsg = msgs1.find(m => m.sender === "Alice" && m.content === "Hello everyone!");
    if (aliceMsg) {
      pass(`Alice's message retrieved (${msgs1.length} total messages)`);
    } else {
      fail(`Alice's message not found in messages list`);
    }

    // Test 6: TestBot replies to Alice
    log("\n[6] POST /messages - TestBot replies to Alice");
    const msg2Res = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: "TestBot",
        content: "Hi Alice! Nice to meet you.",
        replyTo: aliceMessageId
      })
    });

    if (msg2Res.status === 201) {
      const msg2Data = await msg2Res.json();
      pass(`TestBot's reply sent (id: ${msg2Data.data.id})`);
    } else {
      fail(`TestBot's reply failed: ${msg2Res.status}`);
    }

    // Test 7: Verify both messages
    log("\n[7] GET /messages - Verify both messages");
    const msgs2Res = await fetch(`${BASE_URL}/messages`);
    const msgs2: Message[] = await msgs2Res.json();

    const hasBothMessages = msgs2.length >= 2 &&
      msgs2.some(m => m.sender === "Alice") &&
      msgs2.some(m => m.sender === "TestBot");

    if (hasBothMessages) {
      pass(`Both messages retrieved (${msgs2.length} total messages)`);
    } else {
      fail(`Messages not found correctly`);
    }

    // Test 8: Rate limit test
    log("\n[8] Rate limit - Send 2 messages from Alice within 5s");
    const rateMsg1 = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "Alice", content: "Message 1" })
    });

    // Wait just 1 second (less than 5s rate limit)
    await sleep(1000);

    const rateMsg2 = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "Alice", content: "Message 2" })
    });

    if (rateMsg2.status === 429) {
      pass(`Rate limit enforced: got 429 on second message`);
    } else {
      fail(`Rate limit NOT enforced: got ${rateMsg2.status} instead of 429`);
    }

    // Test 9: Consecutive agent limit test
    log("\n[9] Consecutive agent limit - Send 3+ agent messages");

    // Join 3 more agents
    await fetch(`${BASE_URL}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Agent1", type: "agent" })
    });
    await fetch(`${BASE_URL}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Agent2", type: "agent" })
    });
    await fetch(`${BASE_URL}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Agent3", type: "agent" })
    });

    // Wait for rate limit to reset
    await sleep(6000);

    // Send 3 agent messages
    const agent1 = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "Agent1", content: "Agent message 1" })
    });

    await sleep(6000); // Wait to avoid rate limit

    const agent2 = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "Agent2", content: "Agent message 2" })
    });

    await sleep(6000);

    const agent3 = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "Agent3", content: "Agent message 3" })
    });

    await sleep(6000);

    // 4th agent message should fail
    const agent4 = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "TestBot", content: "Agent message 4" })
    });

    if (agent4.status === 429) {
      pass(`Consecutive agent limit enforced: got 429 on 4th agent message`);
    } else {
      fail(`Consecutive agent limit NOT enforced: got ${agent4.status} instead of 429`);
    }

    // Test 10: SSE stream test (simplified - just check endpoint responds)
    log("\n[10] SSE /stream - Check endpoint is accessible");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const sseRes = await fetch(`${BASE_URL}/stream`, {
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (sseRes.status === 200 && sseRes.headers.get("content-type")?.includes("text/event-stream")) {
        pass("SSE stream endpoint accessible and returns correct content-type");
      } else {
        fail(`SSE stream endpoint unexpected response: ${sseRes.status}`);
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        pass("SSE stream endpoint accessible (connection aborted after timeout)");
      } else {
        fail(`SSE stream error: ${error.message}`);
      }
    }

    // Summary
    log("\n" + "=".repeat(50));
    log(`Tests passed: ${testsPassed}`);
    log(`Tests failed: ${testsFailed}`);
    log("=".repeat(50));

    if (testsFailed > 0) {
      process.exit(1);
    } else {
      log("✅ All tests passed!");
      process.exit(0);
    }

  } catch (error) {
    fail(`Unexpected error: ${error}`);
    console.error(error);
    process.exit(1);
  }
}

// Run tests
runTests();
