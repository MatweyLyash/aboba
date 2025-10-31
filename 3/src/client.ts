import dgram from 'dgram';

const client = dgram.createSocket('udp4');
const proxyIp = '10.147.90.153';
const proxyPort = 5555;

client.on('message', (msg) => {
    console.log(`Received time: ${msg.toString()}`);
});

setInterval(() => {
    client.send('TIME_REQUEST', proxyPort, proxyIp);
    console.log('Time request sent');
}, 3000);
