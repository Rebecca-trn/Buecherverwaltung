const net = require("net");
const mqtt = require("mqtt");

const MQTT_URL = process.env.MQTT_URL || "wss://mqtt.zimolong.eu/";
const MQTT_TOPIC = "rebecca-ms1/events";
const clientId = "ms2-" + Math.random().toString(16).slice(2);

let client;
console.log(`[MS2] Welcome at Rebecca's Version of MS2 Module`)

function waitForBroker() {
  return new Promise((resolve) => {
    const tryConnect = () => {
      const tempClient = mqtt.connect(MQTT_URL, {
        clientId: "ms2-checker-" + Math.random().toString(16).slice(2),
        username: process.env.MQTT_USERNAME || "dhbw",
        password: process.env.MQTT_PASSWORD || "dhbw",
        reconnectPeriod: 0,
        connectTimeout: 3000
      });

      tempClient.once("connect", () => {
        tempClient.end();
        resolve();
      });

      tempClient.once("error", () => {
        tempClient.end();
        setTimeout(tryConnect, 1000);
      });
    };

    tryConnect();
  });
}

function startClient() {
  client = mqtt.connect(MQTT_URL, {
    clientId,
    username: process.env.MQTT_USERNAME || "dhbw",
    password: process.env.MQTT_PASSWORD || "dhbw",
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
  const names = { books: "Buch", authors: "Autor", publishers: "Verlag", ms1: "MS1" };
  const res = names[msg.resource] || msg.resource || "Ressource";

  const actions = {
    created: "angelegt",
    updated: "aktualisiert",
    deleted: "gelöscht",
    connected: "verbunden"
  };
  const action = actions[msg.change] || msg.change || "geändert";

  const when = msg.ts ? new Date(msg.ts) : new Date();
  const whenStr = when.toLocaleString();

  if (msg.message) {
    return `[${whenStr}] ${msg.message}`;
  }

  return `[${whenStr}] ${res} #${msg.id} wurde ${action}.`;
}
