#!/usr/bin/env npx ts-node

// Simple test that directly tests the iTerm MCP server functionality
// This bypasses the complex MCP client transport issues

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

async function testMCPServer() {
  console.log("🚀 Starting simple MCP server test...");

  const serverProcess = spawn('npx', ['ts-node', 'index.ts'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverReady = false;

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server startup timeout"));
    }, 10000);

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log(`[SERVER]: ${output.trim()}`);
      
      if (output.includes("Starting stateless iTerm MCP server")) {
        serverReady = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log("✅ Server is ready!");

  try {
    // Test 1: List tools
    console.log("\n📋 Test 1: Listing available tools...");
    const listToolsRequest = createMCPRequest("tools/list");
    
    const response1 = await sendMCPRequest(serverProcess, listToolsRequest);
    if (response1.result && response1.result.tools) {
      console.log(`✅ Found ${response1.result.tools.length} tools:`);
      response1.result.tools.forEach((tool: any, index: number) => {
        console.log(`   ${index + 1}. ${tool.name}: ${tool.description}`);
      });
    } else {
      console.log("❌ No tools found in response");
    }

    // Test 2: Create new tab
    console.log("\n🆕 Test 2: Creating a new tab...");
    const createTabRequest = createMCPRequest("tools/call", {
      name: "iterm_new_tab",
      arguments: {}
    });
    
    const response2 = await sendMCPRequest(serverProcess, createTabRequest);
    if (response2.result && response2.result.content) {
      console.log(`✅ ${response2.result.content[0].text}`);
    } else {
      console.log("❌ Failed to create tab:", response2.error);
    }

    // Test 3: Get tab info
    console.log("\n📊 Test 3: Getting tab information...");
    const getTabsRequest = createMCPRequest("tools/call", {
      name: "iterm_get_all_tabs_info",
      arguments: {}
    });
    
    const response3 = await sendMCPRequest(serverProcess, getTabsRequest);
    if (response3.result && response3.result.content) {
      console.log("✅ Tab info retrieved:");
      console.log(response3.result.content[0].text);
    } else {
      console.log("❌ Failed to get tab info:", response3.error);
    }

    // Test 4: Tail all tabs
    console.log("\n👀 Test 4: Tailing all tabs...");
    const tailRequest = createMCPRequest("tools/call", {
      name: "iterm_tail_tab_all",
      arguments: { lines: 3 }
    });
    
    const response4 = await sendMCPRequest(serverProcess, tailRequest);
    if (response4.result && response4.result.content) {
      console.log("✅ Tab content retrieved:");
      console.log(response4.result.content[0].text.substring(0, 200) + "...");
    } else {
      console.log("❌ Failed to tail tabs:", response4.error);
    }

    console.log("\n🎉 All tests completed successfully!");

  } catch (error) {
    console.error("\n❌ Test failed:", error);
  } finally {
    console.log("\n🧹 Cleaning up...");
    serverProcess.kill();
    console.log("✅ Test completed!");
  }
}

async function sendMCPRequest(process: any, request: MCPRequest): Promise<MCPResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Request timeout"));
    }, 5000);

    let responseData = '';

    const onData = (data: Buffer) => {
      responseData += data.toString();
      try {
        const response = JSON.parse(responseData.trim());
        if (response.id === request.id) {
          clearTimeout(timeout);
          process.stdout.off('data', onData);
          resolve(response);
        }
      } catch (e) {
        // Still accumulating data
      }
    };

    process.stdout.on('data', onData);

    // Send request
    const requestStr = JSON.stringify(request) + '\n';
    process.stdin.write(requestStr);
  });
}

// Run the test
testMCPServer().catch(console.error); 