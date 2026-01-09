// mcp.js - Model Context Protocol Client (SSE)

class McpClient {
    constructor(name, sseUrl) {
        this.name = name;
        this.sseUrl = sseUrl;
        this.postUrl = null;
        this.eventSource = null;
        this.sessionId = null;
        this.tools = [];
        this.status = 'disconnected';
        this.idCounter = 0;
        this.pendingRequests = {}; // id -> {resolve, reject}
    }

    async connect() {
        if (this.status === 'connected') return;
        this.status = 'connecting';
        console.log(`[MCP ${this.name}] Connecting to ${this.sseUrl}...`);

        return new Promise((resolve, reject) => {
            try {
                this.eventSource = new EventSource(this.sseUrl);

                this.eventSource.onopen = () => {
                    console.log(`[MCP ${this.name}] SSE Open`);
                };

                this.eventSource.onerror = (err) => {
                    console.error(`[MCP ${this.name}] SSE Error`, err);
                    this.status = 'error';
                    // Retry logic could go here
                };

                // Listen for the 'endpoint' event which tells us where to POST
                this.eventSource.addEventListener('endpoint', async (event) => {
                    // The data is the relative or absolute URL
                    const uri = event.data;
                    this.postUrl = new URL(uri, this.sseUrl).toString();
                    console.log(`[MCP ${this.name}] Endpoint received: ${this.postUrl}`);

                    try {
                        await this.initialize();
                        this.status = 'connected';
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });

                // Listen for 'message' (JSON-RPC responses/notifications)
                this.eventSource.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };

            } catch (e) {
                this.status = 'error';
                reject(e);
            }
        });
    }

    handleMessage(data) {
        // Handle Responses
        if (data.id !== undefined && this.pendingRequests[data.id]) {
            const { resolve, reject } = this.pendingRequests[data.id];
            delete this.pendingRequests[data.id];
            if (data.error) reject(data.error);
            else resolve(data.result);
        }
        // Handle Notifications (optional)
    }

    async rpcRequest(method, params = {}) {
        if (!this.postUrl) throw new Error("No POST endpoint established inside MCP");

        const id = this.idCounter++;
        const payload = {
            jsonrpc: "2.0",
            method,
            params,
            id
        };

        // We send via POST
        const initialFetch = await fetch(this.postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Current MCP-over-SSE spec: The response body is strictly for HTTP errors, 
        // the actual JSON-RPC response comes via the SSE stream.
        // UNLESS it's an error immediately.

        if (!initialFetch.ok) {
            throw new Error(`MCP Post Error: ${initialFetch.statusText}`);
        }

        // Wait for response via SSE
        return new Promise((resolve, reject) => {
            this.pendingRequests[id] = { resolve, reject };
            // Timeout safety
            setTimeout(() => {
                if (this.pendingRequests[id]) {
                    delete this.pendingRequests[id];
                    reject(new Error("RPC Timeout"));
                }
            }, 10000);
        });
    }

    async initialize() {
        console.log(`[MCP ${this.name}] Initializing...`);
        const result = await this.rpcRequest('initialize', {
            protocolVersion: "2024-11-05", // Spec version
            capabilities: {
                roots: { listChanged: false },
                sampling: {}
            },
            clientInfo: {
                name: "OmniAgentExtension",
                version: "1.0.0"
            }
        });

        console.log(`[MCP ${this.name}] Initialized. Server: ${result.serverInfo.name}`);

        // Notify initialized
        // This is a notification, not a request, so no ID and no response wait?
        // Actually, JSON-RPC notifications have no ID.
        // But our `rpcRequest` adds an ID.
        // Let's send a notification manually or just use request and ignore result?
        // Spec says: "after receiving the initialize result... the client MUST send a notifications/initialized notification"

        await fetch(this.postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/initialized"
            })
        });

        // Fetch Tools
        await this.refreshTools();
    }

    async refreshTools() {
        const result = await this.rpcRequest('tools/list');
        this.tools = result.tools || [];
        console.log(`[MCP ${this.name}] Loaded ${this.tools.length} tools.`);
    }
}

// Global Manager
class McpManager {
    constructor() {
        this.clients = {}; // name -> McpClient
    }

    async syncServers(serverConfigs) {
        // sync logic: connect new, disconnect removed
        const newNames = new Set(serverConfigs.map(s => s.name));

        // Disconnect removed
        for (const name of Object.keys(this.clients)) {
            if (!newNames.has(name)) {
                console.log(`[MCP] Removing server ${name}`);
                this.clients[name].eventSource?.close();
                delete this.clients[name];
            }
        }

        // Connect new
        for (const config of serverConfigs) {
            if (!this.clients[config.name]) {
                const client = new McpClient(config.name, config.url);
                this.clients[config.name] = client;
                // Don't await connection to avoid blocking everything
                client.connect().catch(e => console.error(`Failed to connect to ${config.name}`, e));
            }
        }
    }

    getAllTools() {
        let allTools = [];
        for (const client of Object.values(this.clients)) {
            if (client.status === 'connected') {
                allTools = allTools.concat(client.tools.map(t => ({
                    ...t,
                    // Namespace the tool to avoid collisions?
                    // Let's keep original name but maybe add property 'source'
                    source: client.name
                })));
            }
        }
        return allTools;
    }

    async callTool(sourceName, toolName, args) {
        const client = this.clients[sourceName];
        if (!client) throw new Error(`MCP Server '${sourceName}' not found.`);
        return await client.rpcRequest('tools/call', {
            name: toolName,
            arguments: args
        });
    }
}

// Export global
self.McpManager = McpManager;
