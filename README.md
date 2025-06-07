# iTerm MCP Server

A Model Context Protocol (MCP) server for interacting with iTerm2 on macOS.

```
  _____         _____                    __  __  _____ _____  
 |_   _|       |_   _|                  |  \/  |/ ____|  __ \ 
   | |  ___ _ __ | |    ___  _ __ ___   | \  / | |    | |__) |
   | | / _ \ '__|| |   / _ \| '_ ` _ \  | |\/| | |    |  ___/ 
  _| ||  __/ |  _| |__| (_) | | | | | | | |  | | |____| |     
 |_____\___|_| |______\___/|_| |_| |_| |_|  |_|\_____|_|     
```

## Features

- Create new iTerm tabs
- List the content of tabs
- Run commands in tabs
- Send control codes to tabs
- Get information about running tabs

## Requirements

- macOS
- iTerm2 installed
- Node.js >= 18.0.0

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/mcp-iterm.git
cd mcp-iterm

# Install dependencies
npm install

# Make the script executable
chmod +x index.js
```

## Usage

### Running the Server

```bash
# Start the server
npm start

# Or with debugging
npm run debug
```

## Troubleshooting

If the server doesn't start properly:

1. Make sure iTerm2 is running
2. Check the permissions on the index.js file (`chmod +x index.js`)
3. Check the log output in `/tmp/mcp-iterm.log` or via console
4. Try running it in debug mode: `npm run debug`

## Available Tools

The MCP server provides the following tools:

- `iterm_new_tab`: Creates a new tab
- `iterm_tail_tab_all`: Lists all tabs with their output tails
- `iterm_tail_tab_single`: Shows the last N lines from a specific tab
- `iterm_run_command_blocking`: Runs a command and waits for completion
- `iterm_run_command_async`: Runs a command without waiting
- `iterm_control_code`: Sends a control code (e.g., Ctrl+C)
- `iterm_get_all_tabs_info`: Gets information about all tabs

## Log Location

Logs are written to `/tmp/mcp-iterm.log` and also to the console.

## License

MIT
