import dgram from 'dgram';
import fs from 'fs';

interface ServerConfig {
    ip: string;
    port: number;
}

interface Config {
    servers: ServerConfig[];
    healthCheckInterval: number;
    healthCheckTimeout: number;
    maxFailedChecks: number;
}

class TimeServer {
    private socket: dgram.Socket;
    private myIp: string;
    private myPort: number;
    private config: Config;
    private coordinatorIp: string | null = null;
    private failedChecks = 0;
    private isCoordinator = false;
    private electionInProgress = false;

    constructor(ip: string, port: number) {
        this.socket = dgram.createSocket('udp4');
        this.myIp = ip;
        this.myPort = port;
        this.config = JSON.parse(fs.readFileSync("D:\\Desktop\\labs\\rios\\3\\config.json", 'utf-8'));
    }

    start() {
        this.socket.bind(this.myPort, this.myIp, () => {
            console.log(`[${this.myIp}] The time server is running on ${this.myIp}:${this.myPort}`);
            this.startElection();
        });

        this.socket.on('message', (msg, rinfo) => {
            this.handleMessage(msg, rinfo);
        });

        this.socket.on('error', (err) => {
            console.error(`[${this.myIp}] Server error:`, err);
        });

        setInterval(() => this.checkCoordinator(), this.config.healthCheckInterval);
    }

    private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
        const message = msg.toString();
        const [type, ...args] = message.split(':');

        switch (type) {
            case 'TIME_REQUEST':
                this.sendTimeResponse(rinfo);
                break;
            case 'HEALTH_CHECK':
                this.sendHealthResponse(rinfo);
                break;
            case 'ELECTION':
                this.handleElection(args[0], rinfo);
                break;
            case 'COORDINATOR':
                this.handleCoordinatorAnnouncement(args[0]);
                break;
            case 'OK':
                this.handleOkResponse();
                break;
            case 'HEALTH_RESPONSE':
                break;
        }
    }

    private sendTimeResponse(rinfo: dgram.RemoteInfo) {
        const now = new Date();
        const time = this.formatTime(now);
        this.socket.send(`TIME:${time}`, rinfo.port, rinfo.address);
        console.log(`[${this.myIp}] Sent time ${time} for client ${rinfo.address}:${rinfo.port}`);
    }

    private formatTime(date: Date): string {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${dd}${mm}${yyyy}:${hours}:${minutes}:${seconds}`;
    }

    private sendHealthResponse(rinfo: dgram.RemoteInfo) {
        this.socket.send('HEALTH_RESPONSE', rinfo.port, rinfo.address);
    }

    private ipSum(ip: string): number {
        return ip.split('.').map(Number).reduce((a, b) => a + b, 0);
    }

    private startElection() {
        if (this.electionInProgress) return;

        console.log(`[${this.myIp}] Start election...`);
        this.electionInProgress = true;

        const mySum = this.ipSum(this.myIp);
        const higherServers = this.config.servers.filter(s => this.ipSum(s.ip) > mySum);

        if (higherServers.length === 0) {
            this.becomeCoordinator();
            return;
        }

        let okReceived = false;

        higherServers.forEach(server => {
            this.socket.send(`ELECTION:${this.myIp}`, server.port, server.ip);
        });

        const okTimeout = setTimeout(() => {
            if (!okReceived && this.electionInProgress) {
                this.becomeCoordinator();
            }
        }, 2000);

        const handleOk = (msg: Buffer) => {
            if (msg.toString().startsWith('OK')) {
                okReceived = true;
                clearTimeout(okTimeout);
                this.electionInProgress = false;
                this.isCoordinator = false;
                this.socket.off('message', handleOk);
            }
        };

        this.socket.on('message', handleOk);
    }

    private handleElection(senderIp: string, rinfo: dgram.RemoteInfo) {
        console.log(`[${this.myIp}] Received message ELECTION by ${senderIp}`);
        this.socket.send('OK', rinfo.port, rinfo.address);

        if (!this.electionInProgress && !this.isCoordinator) {
            setTimeout(() => this.startElection(), 1000);
        }
    }

    private handleOkResponse() {
        console.log(`[${this.myIp}] Received message OK, stop election...`);
        this.electionInProgress = false;
        this.isCoordinator = false;
    }

    private becomeCoordinator() {
        console.log(`[${this.myIp}] Becomes coordinator...`);
        this.isCoordinator = true;
        this.coordinatorIp = this.myIp;
        this.electionInProgress = false;

        this.config.servers.forEach(server => {
            if (server.ip !== this.myIp) {
                this.socket.send(`COORDINATOR:${this.myIp}`, server.port, server.ip);
            }
        });

        fs.writeFileSync('coordinator.txt', this.myIp);

        this.notifyProxyAboutCoordinator();
    }

    private notifyProxyAboutCoordinator() {
        try {
            const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
            if (!config.proxyIp || !config.proxyPort) {
                console.warn(`[${this.myIp}] Proxy config not found in config.json`);
                return;
            }

            const message = `COORDINATOR_ANNOUNCE:${this.myIp}:${this.myPort}`;
            this.socket.send(message, config.proxyPort, config.proxyIp, (err) => {
                if (err) {
                    console.error(`[${this.myIp}] Failed to notify proxy:`, err);
                } else {
                    console.log(`[${this.myIp}] Notified proxy (${config.proxyIp}:${config.proxyPort}) that I am coordinator`);
                }
            });
        } catch (err) {
            console.error(`[${this.myIp}] Error while notifying proxy:`, err);
        }
    }

    private handleCoordinatorAnnouncement(coordinatorIp: string) {
        console.log(`[${this.myIp}] New coordinator: ${coordinatorIp}`);
        this.coordinatorIp = coordinatorIp;
        this.isCoordinator = false;
        this.electionInProgress = false;
        this.failedChecks = 0;

        setTimeout(() => {}, this.config.healthCheckInterval * 2);
    }

    private checkCoordinator() {
        if (this.isCoordinator || this.electionInProgress || !this.coordinatorIp) return;

        const server = this.config.servers.find(s => s.ip === this.coordinatorIp);
        if (!server) return;

        const timeout = setTimeout(() => {
            this.failedChecks++;
            console.log(`[${this.myIp}] Coordinator not responding (${this.failedChecks}/${this.config.maxFailedChecks})`);
            if (this.failedChecks >= this.config.maxFailedChecks) {
                console.log(`[${this.myIp}] Coordinator not available, start election...`);
                this.coordinatorIp = null;
                this.failedChecks = 0;
                this.startElection();
            }
        }, this.config.healthCheckTimeout);

        const listener = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
            if (rinfo.address === server.ip && msg.toString() === 'HEALTH_RESPONSE') {
                clearTimeout(timeout);
                this.failedChecks = 0;
                this.socket.off('message', listener);
            }
        };

        this.socket.on('message', listener);
        this.socket.send('HEALTH_CHECK', server.port, server.ip);
    }


}

const serverIp = process.argv[2];
const serverPort = parseInt(process.argv[3] || '5555');

if (!serverIp) {
    console.error('Enter server ip address');
    process.exit(1);
}

const server = new TimeServer(serverIp, serverPort);
server.start();
