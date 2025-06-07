#!/usr/bin/env npx ts-node

// Comprehensive test suite for iTerm MCP server
// Tests all 7 tools plus error handling and edge cases

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

async function comprehensiveTest() {
  console.log("🧪 Starting comprehensive iTerm MCP server test suite...");

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

  console.log("✅ Server ready! Running comprehensive tests...\n");

  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Test 1: List tools
    console.log("📋 Test 1: List all tools");
    const listResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/list"));
    if (listResponse.result?.tools?.length === 7) {
      console.log("✅ All 7 tools found");
      testsPassed++;
    } else {
      console.log("❌ Expected 7 tools, got", listResponse.result?.tools?.length);
      testsFailed++;
    }

    // Test 2: Create new tab
    console.log("\n🆕 Test 2: Create new tab");
    const createResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_new_tab",
      arguments: {}
    }));
    if (createResponse.result?.content?.[0]?.text?.includes("New tab created")) {
      console.log("✅ New tab created successfully");
      testsPassed++;
    } else {
      console.log("❌ Failed to create tab:", createResponse.error);
      testsFailed++;
    }

    // Wait a moment for tab to settle
    await new Promise(r => setTimeout(r, 1000));

    // Test 3: Get tab info
    console.log("\n📊 Test 3: Get all tab info");
    const infoResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_get_all_tabs_info",
      arguments: {}
    }));
    if (infoResponse.result?.content?.[0]?.text?.includes("Tab Information")) {
      console.log("✅ Tab info retrieved");
      testsPassed++;
    } else {
      console.log("❌ Failed to get tab info:", infoResponse.error);
      testsFailed++;
    }

    // Test 4: Tail single tab
    console.log("\n👀 Test 4: Tail single tab (tab 1)");
    const tailSingleResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_tail_tab_single",
      arguments: { tab: 1, lines: 5 }
    }));
    if (tailSingleResponse.result?.content?.[0]?.text) {
      console.log("✅ Single tab content retrieved");
      testsPassed++;
    } else {
      console.log("❌ Failed to tail single tab:", tailSingleResponse.error);
      testsFailed++;
    }

    // Test 5: Run blocking command
    console.log("\n⚡ Test 5: Run blocking command");
    const blockingResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_run_command_blocking",
      arguments: { 
        tab: 1, 
        command: "echo 'Hello from blocking test' && date", 
        wait: 3 
      }
    }));
    if (blockingResponse.result?.content?.[0]?.text?.includes("Hello from blocking test")) {
      console.log("✅ Blocking command executed successfully");
      testsPassed++;
    } else {
      console.log("❌ Blocking command failed:", blockingResponse.error);
      testsFailed++;
    }

    // Test 6: Run async command with tail
    console.log("\n🚀 Test 6: Run async command with tail");
    const asyncResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_run_command_async",
      arguments: { 
        tab: 1, 
        command: "echo 'Hello from async test' && sleep 1 && echo 'Async complete'", 
        wait: 2,
        tailLines: 3
      }
    }));
    if (asyncResponse.result?.content?.[0]?.text?.includes("sent to tab")) {
      console.log("✅ Async command executed successfully");
      testsPassed++;
    } else {
      console.log("❌ Async command failed:", asyncResponse.error);
      testsFailed++;
    }

    // Test 7: Long-running command and control code
    console.log("\n🛑 Test 7: Long-running command + Control-C");
    
    // Start a long-running command
    const longCommandResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_run_command_async",
      arguments: { 
        tab: 1, 
        command: "sleep 10", 
        wait: 0
      }
    }));
    
    // Wait a moment then send Ctrl+C
    await new Promise(r => setTimeout(r, 1000));
    
    const controlResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_control_code",
      arguments: { tab: 1, letter: "C" }
    }));
    
    if (controlResponse.result?.content?.[0]?.text?.includes("Control-C sent")) {
      console.log("✅ Control-C sent successfully");
      testsPassed++;
    } else {
      console.log("❌ Control-C failed:", controlResponse.error);
      testsFailed++;
    }

    // Test 8: Multi-line command
    console.log("\n📝 Test 8: Multi-line command");
    const multilineResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_run_command_blocking",
      arguments: { 
        tab: 1, 
        command: "echo 'Line 1'\necho 'Line 2'\necho 'Line 3'", 
        wait: 2 
      }
    }));
    if (multilineResponse.result?.content?.[0]?.text?.includes("Line 1")) {
      console.log("✅ Multi-line command executed");
      testsPassed++;
    } else {
      console.log("❌ Multi-line command failed:", multilineResponse.error);
      testsFailed++;
    }

    // Error Test 1: Invalid tab index
    console.log("\n❌ Error Test 1: Invalid tab index");
    const invalidTabResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_tail_tab_single",
      arguments: { tab: 999, lines: 5 }
    }));
    if (invalidTabResponse.result?.content?.[0]?.text?.includes("Error") || invalidTabResponse.error) {
      console.log("✅ Invalid tab index properly handled");
      testsPassed++;
    } else {
      console.log("❌ Invalid tab index not handled properly");
      testsFailed++;
    }

    // Error Test 2: Invalid control letter
    console.log("\n❌ Error Test 2: Invalid control letter");
    const invalidControlResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_control_code",
      arguments: { tab: 1, letter: "123" }
    }));
    if (invalidControlResponse.result?.content?.[0]?.text?.includes("Error") || invalidControlResponse.error) {
      console.log("✅ Invalid control letter properly handled");
      testsPassed++;
    } else {
      console.log("❌ Invalid control letter not handled properly");
      testsFailed++;
    }

    // Test 9: Tail all tabs with custom line count
    console.log("\n👁️ Test 9: Tail all tabs with custom lines");
    const tailAllResponse = await sendMCPRequest(serverProcess, createMCPRequest("tools/call", {
      name: "iterm_tail_tab_all",
      arguments: { lines: 3 }
    }));
    if (tailAllResponse.result?.content?.[0]?.text?.includes("TAB")) {
      console.log("✅ Tail all tabs with custom lines works");
      testsPassed++;
    } else {
      console.log("❌ Tail all tabs failed:", tailAllResponse.error);
      testsFailed++;
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("🏆 TEST SUMMARY");
    console.log("=".repeat(50));
    console.log(`✅ Tests Passed: ${testsPassed}`);
    console.log(`❌ Tests Failed: ${testsFailed}`);
    console.log(`📊 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);
    
    if (testsFailed === 0) {
      console.log("\n🎉 ALL TESTS PASSED! Your iTerm MCP server is fully functional!");
    } else {
      console.log("\n⚠️  Some tests failed. Check the output above for details.");
    }

  } catch (error) {
    console.error("\n💥 Test suite failed:", error);
  } finally {
    console.log("\n🧹 Cleaning up...");
    serverProcess.kill();
    console.log("✅ Comprehensive test completed!");
  }
}

async function sendMCPRequest(process: any, request: MCPRequest): Promise<MCPResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Request timeout"));
    }, 8000); // Longer timeout for blocking commands

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

// Run the comprehensive test
comprehensiveTest().catch(console.error); 