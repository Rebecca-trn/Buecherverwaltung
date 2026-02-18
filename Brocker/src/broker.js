

const net = require("net");

const PORT = 1883;

console.log("[BROKER] Starte lokalen MQTT-Broker auf Port 1883...");

let subscribers = [];

const server = net.createServer((socket) => {
  console.log("[BROKER] Client verbunden.");

  socket.on("data", (data) => {
    const type = data[0] >> 4;

    // CONNECT
    if (type === 1) {
      console.log("[BROKER] CONNECT erhalten.");
      const connack = Buffer.from([0x20, 0x02, 0x00, 0x00]);
      socket.write(connack);
    }

    // SUBSCRIBE
    if (type === 8) {
      console.log("[BROKER] SUBSCRIBE erhalten.");
      subscribers.push(socket);
      const suback = Buffer.from([0x90, 0x03, 0x00, 0x01, 0x00]);
      socket.write(suback);
    }

    // PUBLISH
    if (type === 3) {
      console.log("[BROKER] PUBLISH erhalten → weiterleiten...");
      for (const sub of subscribers) {
        sub.write(data);
      }
    }
  });

  socket.on("error", () => {
    console.log("[BROKER] Client getrennt.");
  });
});

server.listen(PORT, () => {
  console.log(`[BROKER] Läuft auf localhost:${PORT}`);
});