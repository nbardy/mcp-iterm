#!/usr/bin/env npx ts-node

// Focused test for the specific failing features
import { spawn } from 'node:child_process';

interface MCPRequest {
  jsonrpc: string;
  id: string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: any;
}

function createMCPRequest(method: string, params?: any): MCPRequest {
  return {
    jsonrpc: "2.0",
    id: Math.random().toString(36),
    method,
    params
  };
}

async function focusedTest() {
  console.log("🔍 Testing specific failing features...");

  const serverProcess = spawn('npx', ['ts-node', 'index.ts'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server startup timeout"));
    }, 10000);

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes("Starting stateless iTerm MCP server")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log("✅ Server ready! Testing specific features...\n");

  try {
    // Test async command (simplified)
    console.log("🚀 Test: Async command (no tail)");
    const asyncRequest = createMCPRequest("tools/call", {
      name: "iterm_run_command_async",
      arguments: { 
        tab: 1, 
        command: "echo 'Testing async'",
        wait: 0
      }
    });
    
    console.log("Sending request:", JSON.stringify(asyncRequest, null, 2));
    const asyncResponse = await sendMCPRequest(serverProcess, asyncRequest);
    console.log("Response:", JSON.stringify(asyncResponse, null, 2));

    // Test control code
    console.log("\n🛑 Test: Control code");
    const controlRequest = createMCPRequest("tools/call", {
      name: "iterm_control_code",
      arguments: { tab: 1, letter: "C" }
    });
    
    console.log("Sending request:", JSON.stringify(controlRequest, null, 2));
    const controlResponse = await sendMCPRequest(serverProcess, controlRequest);
    console.log("Response:", JSON.stringify(controlResponse, null, 2));

    // Test blocking command with simple output
    console.log("\n⚡ Test: Simple blocking command");
    const blockingRequest = createMCPRequest("tools/call", {
      name: "iterm_run_command_blocking",
      arguments: { 
        tab: 1, 
        command: "echo 'Simple test'", 
        wait: 2 
      }
    });
    
    console.log("Sending request:", JSON.stringify(blockingRequest, null, 2));
    const blockingResponse = await sendMCPRequest(serverProcess, blockingRequest);
    console.log("Response:", JSON.stringify(blockingResponse, null, 2));

  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    console.log("\n🧹 Cleaning up...");
    serverProcess.kill();
    console.log("✅ Focused test completed!");
  }
}

async function sendMCPRequest(process: any, request: MCPRequest): Promise<MCPResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Request timeout for ${request.params?.name || request.method}`));
    }, 10000);

    let responseData = '';

    const onData = (data: Buffer) => {
      responseData += data.toString();
      console.log("Raw response data:", responseData);
      
      try {
        const lines = responseData.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              clearTimeout(timeout);
              process.stdout.off('data', onData);
              resolve(response);
              return;
            }
          }
        }
      } catch (e: any) {
        // Still accumulating data or parsing error
        console.log("Parse error (still accumulating):", e.message);
      }
    };

    process.stdout.on('data', onData);

    // Send request
    const requestStr = JSON.stringify(request) + '\n';
    console.log("Sending:", requestStr);
    process.stdin.write(requestStr);
  });
}

// Run the focused test
focusedTest().catch(console.error); 