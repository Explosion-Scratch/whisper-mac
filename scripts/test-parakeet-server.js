const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// Path to the binary
const apiPath = path.join(__dirname, '../native/parakeet-backend/target/release/parakeet-backend');

console.log(`Spawning: ${apiPath} --server`);

const server = spawn(apiPath, ['--server'], {
    stdio: ['pipe', 'pipe', 'pipe']
});

const rl = readline.createInterface({
    input: server.stdout,
    terminal: false
});

let isReady = false;

rl.on('line', (line) => {
    console.log(`[SERVER]: ${line}`);
    if (line.trim() === 'PARAKEET_SERVER_READY') {
        console.log('Server is ready! Sending a test command...');
        isReady = true;
        
        // Send a test command (invalid JSON to trigger error response, proving the loop works)
        // Or a ping if we had one.
        // Let's send a nonsense command.
        const cmd = JSON.stringify({ command: "ping" }) + "\n";
        server.stdin.write(cmd);
    } else {
        try {
            const resp = JSON.parse(line);
            console.log('Received JSON response:', resp);
            if (resp.status === 'error' && resp.message) {
                 console.log('SUCCESS: Backend responded to generic command.');
                 process.exit(0);
            }
        } catch (e) {
            // Not JSON
        }
    }
});

server.stderr.on('data', (data) => {
    console.error(`[STDERR]: ${data}`);
});

server.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
});

// Timeout
setTimeout(() => {
    console.error('Timeout waiting for server response');
    server.kill();
    process.exit(1);
}, 5000);
