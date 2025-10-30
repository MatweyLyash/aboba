import dgram from 'dgram';
import fs from 'fs';

interface Config {
    proxyIp: string;
    proxyPort: number;
}

class ProxyServer {
    private socket: dgram.Socket;
    private config: Config;
    private pendingRequests = new Map<string, dgram.RemoteInfo>();

    constructor() {
        this.socket = dgram.createSocket('udp4');
        this.config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    }

    start() {
        this.socket.bind(this.config.proxyPort, this.config.proxyIp, () => {
            console.log(`[PROXY] Started on ${this.config.proxyIp}:${this.config.proxyPort}`);
        });

        this.socket.on('message', (msg, rinfo) => {
            this.handleMessage(msg, rinfo);
        });

        this.socket.on('error', (err) => {
            console.error('[PROXY] Error:', err);
        });
    }

    private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
        const message = msg.toString();

        if (message.startsWith('TIME:')) {
            const requestKey = `${rinfo.address}:${rinfo.port}`;
            const clientInfo = this.pendingRequests.get(requestKey);

            if (clientInfo) {
                this.socket.send(msg, clientInfo.port, clientInfo.address);
                console.log(`[PROXY] Response sent to client ${clientInfo.address}:${clientInfo.port}`);
                this.pendingRequests.delete(requestKey);
            }
        } else {
            this.forwardToCoordinator(msg, rinfo);
        }
    }

    private forwardToCoordinator(msg: Buffer, clientInfo: dgram.RemoteInfo) {
        try {
            const coordinatorIp = fs.readFileSync('coordinator.txt', 'utf-8').trim();
            const requestKey = `${coordinatorIp}:5555`;

            this.pendingRequests.set(requestKey, clientInfo);

            this.socket.send(msg, 5555, coordinatorIp);
            console.log(`[PROXY] Request by ${clientInfo.address}:${clientInfo.port} redirected to coordinator ${coordinatorIp}`);

            setTimeout(() => {
                if (this.pendingRequests.has(requestKey)) {
                    console.log(`[PROXY] Error: Coordinator ${coordinatorIp} not responses`);
                    this.pendingRequests.delete(requestKey);
                }
            }, 3000);
        } catch (err) {
            console.error('[PROXY] Error: Can`t to read coordinator address:', err);
        }
    }
}

const proxy = new ProxyServer();
proxy.start();
