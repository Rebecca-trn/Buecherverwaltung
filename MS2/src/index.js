const net = require("net");
const mqtt = require("mqtt");

const MQTT_HOST = process.env.MQTT_HOST || "mqtt-broker";
const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);
const MQTT_URL = `mqtt://${MQTT_HOST}:${MQTT_PORT}`;
const MQTT_TOPIC = "ms1/events";
const clientId = "ms2-" + Math.random().toString(16).slice(2);

let client;

function waitForBroker() {
  return new Promise((resolve) => {
    const tryConnect = () => {
      const socket = net.createConnection(MQTT_PORT, MQTT_HOST);

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();
        setTimeout(tryConnect, 1000);
      });
    };

    tryConnect();
  });
}

function startClient() {
  client = mqtt.connect(MQTT_URL, {
    clientId,
    reconnectPeriod: 2000
  });

  client.on("connect", () => {
    console.log(`[MS2] Verbunden mit ${MQTT_URL}`);
    console.log(`[MS2] Abonniere Topic "${MQTT_TOPIC}"`);

    client.subscribe(MQTT_TOPIC, (err) => {
      if (err) {
        console.error("[MS2] Subscribe-Fehler:", err.message);
      } else {
        console.log(`[MS2] Erfolgreich abonniert: ${MQTT_TOPIC}`);
      }
    });
  });

  client.on("reconnect", () => console.log("[MS2] Reconnect …"));
  client.on("close", () => console.log("[MS2] Verbindung geschlossen"));
  client.on("error", (err) => console.error("[MS2] MQTT-Fehler:", err.message));

  client.on("message", (topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      console.log("[MS2] " + toNiceText(msg));
    } catch (err) {
      console.log("[MS2] Ungültiges JSON:", payload.toString());
    }
  });

  process.on("SIGINT", () => {
    console.log("[MS2] Stoppe MS2 …");
    client.end(true, () => process.exit(0));
  });
}

(async () => {
  console.log("[MS2] Warte auf MQTT-Broker...");
  await waitForBroker();
  console.log("[MS2] MQTT-Broker erreichbar, starte Verbindung...");
  startClient();
})();

function toNiceText(msg) {
  const names = { books: "Buch", authors: "Autor", publishers: "Verlag" };
  const res = names[msg.resource] || msg.resource || "Ressource";

  const actions = {
    created: "angelegt",
    updated: "aktualisiert",
    deleted: "gelöscht",
  };
  const action = actions[msg.change] || msg.change || "geändert";

  const when = msg.ts ? new Date(msg.ts) : new Date();
  const whenStr = when.toLocaleString();

  return `[${whenStr}] ${res} #${msg.id} wurde ${action}.`;
}
