#!/usr/bin/env node

// ==================================================
// Imports and Dependencies
// ==================================================
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const execPromise = promisify(exec);

// ==================================================
// Logging Setup
// ==================================================
const logFilePath = path.join('/tmp', 'mcp-iterm.log');
// Ensure log directory exists
try {
  fs.mkdirSync('/tmp', { recursive: true });
} catch (e: any) {
  // Directory might already exist or we can't create it
  console.error(`Warning: Could not ensure log directory exists: ${e.message}`);
}

function logMessage(message: string) {
  // Always log to console for reliability
  console.error(`[iterm-mcp] ${message}`);
  
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} [iterm-mcp] ${message}\n`;
    fs.appendFileSync(logFilePath, logEntry, 'utf8');
  } catch (err: any) {
    // File logging failed but we already logged to console
    console.error(`[iterm-mcp] Warning: Could not write to log file: ${err.message}`);
  }
}

// ==================================================
// Validation Utilities
// ==================================================
const validate = {
  tabIndex: (tabIndex: any) => {
    if (tabIndex === undefined) {
      return { valid: false, error: "Error: tab parameter is required." };
    }
    
    if (typeof tabIndex !== 'number' || tabIndex < 0 || !Number.isInteger(tabIndex)) {
      return { 
        valid: false, 
        error: `Error: tab parameter must be a non-negative integer, got ${JSON.stringify(tabIndex)}` 
      };
    }
    
    return { valid: true };
  },
  
  command: (command: any) => {
    if (!command) {
      return { valid: false, error: "Error: command parameter is required." };
    }
    
    if (typeof command !== 'string' || command.trim() === '') {
      return { valid: false, error: "Error: command parameter must be a non-empty string" };
    }
    
    return { valid: true };
  },
  
  waitTime: (waitTime: any) => {
    if (waitTime !== undefined && (typeof waitTime !== 'number' || waitTime < 0)) {
      return { 
        valid: false, 
        error: "Error: wait parameter must be a non-negative number" 
      };
    }
    
    return { valid: true };
  },
  
  lines: (lines: any, name = "lines") => {
    if (lines !== undefined && (typeof lines !== 'number' || lines < 0 || !Number.isInteger(lines))) {
      return { 
        valid: false, 
        error: `Error: ${name} parameter must be a non-negative integer` 
      };
    }
    
    return { valid: true };
  },
  
  letter: (letter: any) => {
    if (!letter) {
      return { valid: false, error: "Error: letter parameter is required." };
    }
    
    const upperLetter = letter.toUpperCase();
    if (!/^[A-Z]$/.test(upperLetter)) {
      return { valid: false, error: "Error: Letter must be a single character from A-Z." };
    }
    
    return { valid: true, upperLetter };
  }
};

// ==================================================
// Response Helpers
// ==================================================
const createResponse = {
  success: (text: string) => ({ content: [{ type: "text", text }] }),
  
  error: (error: any) => ({ 
    content: [{ type: "text", text: typeof error === 'string' ? error : `Error: ${error.message}` }] 
  })
};

// ==================================================
// General Utilities
// ==================================================
async function runAppleScript(script: string, timeoutMs = 10000, retries = 2): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const executeWithRetry = async (remainingRetries: number) => {
      const timeoutId = setTimeout(() => {
        clearTimeout(timeoutId);
        if (remainingRetries > 0) {
          console.error(`AppleScript execution timed out, retrying (${remainingRetries} attempts left)...`);
          executeWithRetry(remainingRetries - 1);
        } else {
          reject(new Error(`AppleScript execution timed out after ${timeoutMs}ms and ${retries} retries`));
        }
      }, timeoutMs);
      
      try {
        const { stdout } = await execPromise(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        clearTimeout(timeoutId);
        resolve(stdout.trim());
      } catch (error: any) {
        clearTimeout(timeoutId);
        
        // Check if iTerm2 is not running or not responsive
        if (error.message.includes('No such app') || 
            error.message.includes('connection is invalid') ||
            error.message.includes('not running')) {
          if (remainingRetries > 0) {
            console.error(`iTerm2 access error, retrying (${remainingRetries} attempts left): ${error.message}`);
            await new Promise(r => setTimeout(r, 500)); // Small delay before retry
            executeWithRetry(remainingRetries - 1);
          } else {
            reject(new Error(`iTerm2 unavailable after ${retries} retries: ${error.message}`));
          }
        } else {
          reject(new Error(`AppleScript execution failed: ${error.message}`));
        }
      }
    };
    
    executeWithRetry(retries);
  });
}

function escapeForAppleScript(str: any): string {
  if (typeof str !== 'string') {
    return JSON.stringify(str);
  }
  // Escape backslashes, quotes, newlines, etc.
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "'\\''")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[^\x00-\x7F]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

function trimOutput(content: string, maxSize = 5000): string {
  return content.length <= maxSize
    ? content
    : content.substring(0, maxSize) + "\n\n[Note: Output exceeded maximum size and was trimmed]";
}

// Generate unique marker with timestamp and random bytes
function generateMarker() {
  return `===${crypto.randomBytes(4).toString('hex')}-${Date.now()}===`;
}

// ==================================================
// AppleScript Helpers
// ==================================================
const AS_HELPERS: any = {};

// Base AppleScript with common error checking
AS_HELPERS.baseITermScript = `
tell application "iTerm2"
    if application "iTerm2" is not running then
        error "iTerm2 is not running"
    end if
    
    set numWindows to count of windows
    if numWindows is 0 then
        error "No iTerm2 windows are open"
    end if
`;

// Gets tab count
AS_HELPERS.getTabCount = `
${AS_HELPERS.baseITermScript}
  tell current window
    return count of tabs
  end tell
end tell
`;

// Gets the content of a specific tab
AS_HELPERS.getTabContent = (tabIndex: number) => `
${AS_HELPERS.baseITermScript}
    tell window 1
        set numTabs to count of tabs
        if ${tabIndex + 1} > numTabs then
            error "Tab index out of range. Requested ${tabIndex + 1}, but only " & numTabs & " tabs exist."
        end if
        
        tell tab ${tabIndex + 1}
            tell current session
                return contents
            end tell
        end tell
    end tell
end tell
`;

// Gets info (name, running status) for a *single* tab
AS_HELPERS.getTabInfo = (tabIndex: number) => `
${AS_HELPERS.baseITermScript}
    tell window 1
        set numTabs to count of tabs
        if ${tabIndex + 1} > numTabs then
            error "Tab index out of range. Requested ${tabIndex + 1}, but only " & numTabs & " tabs exist."
        end if

        tell tab ${tabIndex + 1}
            set tabName to "Unknown"
            try
                set tabName to name
            end try
            tell current session
                set tabContent to contents
                set lastLine to last paragraph of tabContent
                set hasPrompt to lastLine ends with "%" or lastLine ends with "$" or lastLine ends with ">"
                return "TAB_NAME:" & tabName & "
TAB_IS_RUNNING:" & (not hasPrompt) & "
TAB_CONTENT:" & tabContent  -- Include content for potential use
            end tell
        end tell
    end tell
end tell
`;

// Template for operations on a specific tab
AS_HELPERS.sessionTemplate = (tabIndex: number, operation: string) => `
${AS_HELPERS.baseITermScript}
    tell window 1
        set numTabs to count of tabs
        if ${tabIndex + 1} > numTabs then
            error "Tab index out of range. Requested ${tabIndex + 1}, but only " & numTabs & " tabs exist."
        end if
        
        tell tab ${tabIndex + 1}
            tell current session
                ${operation}
            end tell
        end tell
    end tell
end tell
`;

// Sends a command to the current session; supports multi‑line commands via a temporary file
AS_HELPERS.sendCommand = (tabIndex: number, command: string) => {
  if (command.includes("\n")) {
    try {
      const tmpFile = `/tmp/iterm_cmd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.sh`;
      fs.writeFileSync(tmpFile, command);
      return AS_HELPERS.sessionTemplate(tabIndex, `write text "source ${tmpFile} && rm ${tmpFile}"`);
    } catch (err: any) {
      // If we can't create a temp file, fall back to writing the command directly
      console.error(`[iterm-mcp] Error creating temp file: ${err.message}`);
      // For multi-line commands without temp file capability, we'll escape the newlines
      const escapedCmd = command.replace(/\n/g, '; ');
      return AS_HELPERS.sessionTemplate(tabIndex, `write text "${escapeForAppleScript(escapedCmd)}"`);
    }
  }
  return AS_HELPERS.sessionTemplate(tabIndex, `write text "${escapeForAppleScript(command)}"`);
};

// Marks the beginning of a command for later extraction
AS_HELPERS.sendMarkedCommand = (tabIndex: number, command: string, marker: string) => {
  const markedCommand = `echo "${marker}-START"; ${command}; RESULT=$?; echo "${marker}-END:$RESULT"`;
  return AS_HELPERS.sendCommand(tabIndex, markedCommand);
};

// Creates a new tab
AS_HELPERS.createNewTab = `
${AS_HELPERS.baseITermScript}
    tell current window
        create tab with default profile
    end tell
end tell
`;

// Sends a control character - FIXED VERSION
AS_HELPERS.sendControlChar = (tabIndex: number, controlCode: number) => AS_HELPERS.sessionTemplate(tabIndex, `write hex ${controlCode.toString(16)}`);

// ==================================================
// Content Extraction Utilities
// ==================================================

// Extract content between start marker and end marker
function extractMarkedContent(fullContent: string, marker: string) {
  const startMarker = `${marker}-START`;
  const endMarkerPattern = new RegExp(`${marker}-END:(\\d+)`);
  
  const startIndex = fullContent.indexOf(startMarker);
  if (startIndex === -1) {
    return { content: "", exitCode: -1 }; // Start marker not found
  }
  
  const afterStart = fullContent.substring(startIndex + startMarker.length);
  const endMatch = afterStart.match(endMarkerPattern);
  
  if (!endMatch) {
    return { content: afterStart, exitCode: -1 }; // End marker not found, return everything after start
  }
  
  const endIndex = afterStart.indexOf(endMatch[0]);
  const extractedContent = afterStart.substring(0, endIndex).trim();
  const exitCode = parseInt(endMatch[1], 10);
  
  return { content: extractedContent, exitCode };
}

// Parse the output from a single tab info request
function parseSingleTabInfo(tabData: string, tabIndex: number) {
    const nameMatch = tabData.match(/TAB_NAME:([^\n]*)/);
    const runningMatch = tabData.match(/TAB_IS_RUNNING:(true|false)/);
    const contentStart = tabData.indexOf("TAB_CONTENT:");

    if (contentStart !== -1) {
        const name = nameMatch ? nameMatch[1] : "Unknown";
        const isRunning = runningMatch ? runningMatch[1] === 'true' : false;
        const content = tabData.substring(contentStart + 12).trim();

        return { index: tabIndex, name, isRunning, content };
    }

    return { index: tabIndex, name: "Unknown", isRunning: false, content: "Error parsing tab data" };
}

// Utility to get tab count
async function getTabCount(): Promise<number> {
    return parseInt(await runAppleScript(AS_HELPERS.getTabCount), 10);
}

// Utility to get content for a specific tab
async function getTabContent(tabIndex: number): Promise<string> {
    const content = await runAppleScript(AS_HELPERS.getTabContent(tabIndex));
    return content;
}

// Utility to get detailed info for a specific tab, or all tabs
async function getAllTabInfo() {
    const tabCount = await getTabCount();
    const tabs = [];
    for (let i = 0; i < tabCount; i++) {
        try {
            const tabData = await runAppleScript(AS_HELPERS.getTabInfo(i));
            tabs.push(parseSingleTabInfo(tabData, i));
        } catch (tabError: any) {
            tabs.push({ index: i, name: `Tab ${i}`, isRunning: false, content: `Error accessing tab: ${tabError.message}` });
        }
    }
    return tabs;
}

// ==================================================
// Command Implementations
// ==================================================
const commands = {
  // Creates a new tab
  async createNewTab() {
    try {
      await runAppleScript(AS_HELPERS.createNewTab);
      return createResponse.success("New tab created successfully.");
    } catch (error: any) {
      return createResponse.error(`Error creating new tab: ${error.message}`);
    }
  },
  
    // Lists all tabs with tail of their output
    async TailTabAll(args: any) {
        const lines = args?.lines || 20;
        const validation = validate.lines(lines);
        if (!validation.valid) {
            return createResponse.error(validation.error);
        }

        try {
            const tabs = await getAllTabInfo(); // Use the new function

            const formattedOutput = tabs.map(tab => {
                // Get the last N lines
                const contentLines = tab.content.split("\n");
                const lastLines = contentLines.slice(-lines).join("\n");

                return `========== TAB ${tab.index}: ${tab.name} ==========\n\n${trimOutput(lastLines)}`;
            }).join("\n\n" + "-".repeat(50) + "\n\n");

            return createResponse.success(trimOutput(formattedOutput, 10000));
        } catch (error: any) {
            return createResponse.error(`Error listing tabs: ${error.message}`);
        }
    },

    // Shows tail of specific tab
    async TailTabSingle(args: any) {
        const { tab: tabIndex, lines = 50 } = args || {};

        // Validate inputs
        const tabValidation = validate.tabIndex(tabIndex);
        if (!tabValidation.valid) {
            return createResponse.error(tabValidation.error);
        }

        const linesValidation = validate.lines(lines);
        if (!linesValidation.valid) {
            return createResponse.error(linesValidation.error);
        }

        try {
            const tabCount = await getTabCount();
            if(tabIndex < 0 || tabIndex >= tabCount) {
                return createResponse.error(`Error: Tab index ${tabIndex} is out of bounds. There are only ${tabCount} tabs.`);
            }

            const tabContent = await getTabContent(tabIndex); // Get *just* the content
            const tabInfo = await runAppleScript(AS_HELPERS.getTabInfo(tabIndex)); //for name
            const tabName = parseSingleTabInfo(tabInfo, tabIndex).name;

            // Get the last N lines
            const contentLines = tabContent.split("\n");
            const lastLines = contentLines.slice(-lines).join("\n");

            return createResponse.success(`Tab ${tabIndex} (${tabName}):\n\n${trimOutput(lastLines)}`);
        } catch (error: any) {
            return createResponse.error(`Error accessing tab ${tabIndex}: ${error.message}`);
        }
    },
  
  // Runs command and waits for completion
  async runCommandBlocking(args: any) {
    const { tab: tabIndex, command, wait: waitTime = 5 } = args || {};
    
    // Validate inputs
    const tabValidation = validate.tabIndex(tabIndex);
    if (!tabValidation.valid) {
      return createResponse.error(tabValidation.error);
    }
    
    const commandValidation = validate.command(command);
    if (!commandValidation.valid) {
      return createResponse.error(commandValidation.error);
    }
    
    const waitValidation = validate.waitTime(waitTime);
    if (!waitValidation.valid) {
      return createResponse.error(waitValidation.error);
    }
    
    try {
      const marker = generateMarker();
      await runAppleScript(AS_HELPERS.sendMarkedCommand(tabIndex, command, marker));
      
      // Wait for the specified time
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      
      // Get just the content (not the tab name) after execution
      const content = await runAppleScript(AS_HELPERS.getTabContent(tabIndex));
      const { content: extractedContent, exitCode } = extractMarkedContent(content, marker);
      
      let statusMessage;
      if (exitCode === -1) {
        statusMessage = `Command is still running in tab ${tabIndex} (no completion marker found).`;
      } else {
        statusMessage = `Command completed in tab ${tabIndex} with exit code ${exitCode}.`;
      }
      
      return createResponse.success(`${statusMessage} Output:\n\n${trimOutput(extractedContent)}`);
    } catch (error: any) {
      return createResponse.error(`Error executing command in tab ${tabIndex}: ${error.message}`);
    }
  },
  
  // Runs command asynchronously
  async runCommandAsync(args: any) {
    const { 
      tab: tabIndex, 
      command, 
      wait: waitTime = 0, 
      tailLines = 0 
    } = args || {};
    
    // Validate inputs
    const tabValidation = validate.tabIndex(tabIndex);
    if (!tabValidation.valid) {
      return createResponse.error(tabValidation.error);
    }
    
    const commandValidation = validate.command(command);
    if (!commandValidation.valid) {
      return createResponse.error(commandValidation.error);
    }
    
    const waitValidation = validate.waitTime(waitTime);
    if (!waitValidation.valid) {
      return createResponse.error(waitValidation.error);
    }
    
    const linesValidation = validate.lines(tailLines, "tailLines");
    if (!linesValidation.valid) {
      return createResponse.error(linesValidation.error);
    }
    
    try {
      const marker = generateMarker();
      await runAppleScript(AS_HELPERS.sendMarkedCommand(tabIndex, command, marker));
      
      let outputMessage = `Command "${command}" sent to tab ${tabIndex}.`;
      
      if (waitTime > 0 || tailLines > 0) {
        // Wait if specified
        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
          outputMessage = `Command "${command}" sent to tab ${tabIndex} and waited ${waitTime} seconds.`;
        }
        
        // Get output if requested
        if (tailLines > 0) {
          const content = await getTabContent(tabIndex); // Get *just* the content
          const { content: extractedContent, exitCode } = extractMarkedContent(content, marker);
          
          if (exitCode !== -1) {
            outputMessage += ` Completed with exit code ${exitCode}.`;
          }
          
          const outputLines = extractedContent.split('\n');
          const lastLines = outputLines.slice(-tailLines).join('\n');
          outputMessage += `\n\nOutput (last ${tailLines} lines):\n\n${trimOutput(lastLines)}`;
        }
      }
      
      return createResponse.success(outputMessage);
    } catch (error: any) {
      return createResponse.error(`Error running command in tab ${tabIndex}: ${error.message}`);
    }
  },
  
  // Sends control code to tab
  async sendControlCode(args: any) {
    const { tab: tabIndex, letter } = args || {};
    
    // Validate inputs
    const tabValidation = validate.tabIndex(tabIndex);
    if (!tabValidation.valid) {
      return createResponse.error(tabValidation.error);
    }
    
    const letterValidation = validate.letter(letter);
    if (!letterValidation.valid) {
      return createResponse.error(letterValidation.error);
    }
    
    try {
      const upperLetter = letterValidation.upperLetter;
      const controlCode = upperLetter.charCodeAt(0) - 64;
      await runAppleScript(AS_HELPERS.sendControlChar(tabIndex, controlCode));
      return createResponse.success(`Control-${upperLetter} sent to tab ${tabIndex}.`);
    } catch (error: any) {
      return createResponse.error(`Error sending Control-${letter.toUpperCase()} to tab ${tabIndex}: ${error.message}`);
    }
  },
  
    // Gets detailed information about all tabs
    async GetAllTabInfo() {
        try {
            const tabs = await getAllTabInfo(); // Use new function

            const tabsInfo = tabs.map(tab => ({
                index: tab.index,
                name: tab.name,
                isRunning: tab.isRunning,
                commandRunning: tab.isRunning ? "unknown (detected via content)" : "none"
            }));

            return createResponse.success(`Tab Information:\n\n${JSON.stringify(tabsInfo, null, 2)}`);
        } catch (error: any) {
            return createResponse.error(`Error getting tabs info: ${error.message}`);
        }
    }
};

// ==================================================
// Tool Definitions
// ==================================================
const tools = [
  { 
    name: "iterm_new_tab", 
    description: "Creates a new tab in the current iTerm2 window", 
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: commands.createNewTab
  },
    {
        name: "iterm_tail_tab_all",
        description: "Lists all tabs with their output tails",
        inputSchema: {
            type: "object",
            properties: {
                lines: { type: "number", description: "Number of lines to show for each tab (default: 20)" }
            },
            required: []
        },
        handler: commands.TailTabAll
    },
    {
        name: "iterm_tail_tab_single",
        description: "Shows the last N lines from a specific tab",
        inputSchema: {
            type: "object",
            properties: {
                tab: { type: "number", description: "The tab index (0-based)" },
                lines: { type: "number", description: "Number of lines to show (default: 50)" }
            },
            required: ["tab"]
        },
        handler: commands.TailTabSingle
    },
  { 
    name: "iterm_run_command_blocking", 
    description: "Runs a command in a tab and waits for it to complete", 
    inputSchema: { 
      type: "object", 
      properties: { 
        tab: { type: "number", description: "The tab index (0-based)" }, 
        command: { type: "string", description: "The command to run" }, 
        wait: { type: "number", description: "Seconds to wait for completion (default: 5)" } 
      }, 
      required: ["tab", "command"] 
    },
    handler: commands.runCommandBlocking
  },
  { 
    name: "iterm_run_command_async", 
    description: "Runs a command in a tab and optionally waits before returning", 
    inputSchema: { 
      type: "object", 
      properties: { 
        tab: { type: "number", description: "The tab index (0-based)" }, 
        command: { type: "string", description: "The command to run" }, 
        wait: { type: "number", description: "Seconds to wait before returning (default: 0)" }, 
        tailLines: { type: "number", description: "Number of lines to return from the tab after execution (default: 0)" } 
      }, 
      required: ["tab", "command"] 
    },
    handler: commands.runCommandAsync
  },
  { 
    name: "iterm_control_code", 
    description: "Sends a control code to a tab (e.g., Ctrl+C)", 
    inputSchema: { 
      type: "object", 
      properties: { 
        tab: { type: "number", description: "The tab index (0-based)" }, 
        letter: { type: "string", description: "The letter corresponding to the control character (e.g., 'C' for Control-C)" } 
      }, 
      required: ["tab", "letter"] 
    },
    handler: commands.sendControlCode
  },
    {
        name: "iterm_get_all_tabs_info",
        description: "Gets detailed information about all tabs including running state",
        inputSchema: { type: "object", properties: {}, required: [] },
        handler: commands.GetAllTabInfo
    }
];

// ==================================================
// MCP Server Setup
// ==================================================
const server = new Server(
  { name: "iterm-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

// Tool listing handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  };
});

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const tool = tools.find(t => t.name === request.params.name);
    
    if (!tool) {
      return createResponse.error(`Unknown tool "${request.params.name}"`);
    }
    
    return await tool.handler(request.params.arguments);
  } catch (error: any) {
    logMessage(`Error handling request: ${error}`);
    return createResponse.error(error);
  }
});

// ==================================================
// Server Startup
// ==================================================
async function main() {
  // Set up error handlers for unexpected crashes before anything else
  process.on('uncaughtException', (err) => {
    console.error(`Uncaught Exception: ${err.message}`);
    console.error(err.stack);
  });
  
  process.on('unhandledRejection', (reason: any) => {
    console.error('Unhandled Promise Rejection:', reason);
  });

  try {
    // Ensure we can write logs before starting the server
    console.error("Starting iTerm MCP server...");
    try {
      fs.appendFileSync(logFilePath, "Test write access\n", 'utf8');
    } catch (logErr: any) {
      console.error(`Warning: Unable to write to log file at ${logFilePath}. Falling back to console logging.`);
      console.error(`Error details: ${logErr.message}`);
    }
    
    const transport = new StdioServerTransport();
    logMessage("Starting stateless iTerm MCP server...");
    await server.connect(transport);
  } catch (error: any) {
    console.error(`Failed to start server: ${error}`);
    // Don't exit on error, as it may be a transient issue
    console.error('Server startup encountered an error but will attempt to continue running.')
  }
}

main().catch((error) => {
  console.error(`Server initialization error: ${error}`);
  console.error('Will attempt to continue despite initialization error.');
  // Don't exit on error
});